// File: api/update.js
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const SCHEDULE_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRgy7uZ8caLI4hTPKSjl9e7ztFaM9vdBk4vXDQbPtcybqzXGOm3FMpSJiyrRTzIM3K70z_6XbgBGP_0/pub?output=csv';
const ROSTER_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRe5WoA--wsfCCCvtL8QgQKsJv0z1AIUTY7k5NEYgUF-Ipu3Iotxkcbw7D-Cme6YGUksHy3DmyDYpaO/pub?output=csv';

const delay = ms => new Promise(res => setTimeout(res, ms));

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  try {
    const [scheduleRes, rosterRes] = await Promise.all([
      fetch(SCHEDULE_CSV_URL).then(r => r.text()),
      fetch(ROSTER_CSV_URL).then(r => r.text())
    ]);

    const schedule = parseCSV(scheduleRes);
    const roster = parseCSV(rosterRes);
    const today = getTodayDate();

    const todaysGames = schedule.filter(game => game['Date'] === today);
    const results = [];

    for (const game of todaysGames) {
      const team1 = game['Team 1'];
      const team2 = game['Team 2'];

      const team1Players = roster.filter(p => p.Team === team1 && p['playing?'].toLowerCase() === 'yes');
      const team2Players = roster.filter(p => p.Team === team2 && p['playing?'].toLowerCase() === 'yes');

      const team1Data = await getTeamData(team1Players);
      const team2Data = await getTeamData(team2Players);

      results.push({
        team1, team2,
        score1: team1Data.total,
        score2: team2Data.total,
        roster1: team1Data.lines,
        roster2: team2Data.lines
      });

      await delay(1000); // Delay between games to avoid rate limiting
    }

    const outputPath = path.join(process.cwd(), 'public', 'data.json');
    fs.writeFileSync(outputPath, JSON.stringify({ games: results }, null, 2));

    res.status(200).json({ status: 'ok', gamesCount: results.length });
  } catch (err) {
    console.error('Fetch error:', err);
    res.status(500).json({ error: 'Failed to update data' });
  }
}

// Utils
function parseCSV(csv) {
  const [headerLine, ...lines] = csv.trim().split('\n');
  const headers = headerLine.split(',').map(h => h.trim());
  return lines.map(line => {
    const cols = line.split(',').map(c => c.trim());
    return Object.fromEntries(headers.map((h, i) => [h, cols[i]]));
  });
}

function getTodayDate() {
  const est = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  if (est.getHours() < 7) est.setDate(est.getDate() - 1);
  return `${est.getMonth() + 1}/${est.getDate()}`;
}

async function getTeamData(players) {
  let total = 0;
  const lines = [];

  for (const p of players) {
    const userId = p['User ID']?.trim();
    const userAt = p['User @']?.trim() || 'Unknown';
    if (!userId || userId === 'not found') {
      lines.push(`${userAt}: missing ID`);
      continue;
    }

    try {
      const apiUrl = `https://api.real.vg/user/${userId}/karmafeed`;
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(apiUrl)}`;
      const res = await fetch(proxyUrl).then(r => r.json());
      const delta = JSON.parse(res.contents)?.stats?.karmaDelta ?? 0;

      const deduction = parseFloat(p['deductions'] || 0);
      const adjusted = delta - deduction;
      const isCaptain = (p.role || '').toLowerCase() === 'captain';
      const boosted = isCaptain ? adjusted * 1.5 : adjusted;

      total += boosted;

      const rounded = Math.round(adjusted);
      const boostedRounded = Math.round(boosted);
      lines.push(
        isCaptain
          ? `${userAt} (c): ${rounded} → ${boostedRounded}`
          : `${userAt}: ${rounded}`
      );

      await delay(500); // Delay between player fetches
    } catch {
      lines.push(`${userAt}: fetch error`);
    }
  }

  return { total: Math.round(total), lines };
}

