// utils/trainBoard.js
// Builds and maintains the sticky Train Board embed.
// When an ops session is active and GRDNConnect is reachable, loco→job data
// is pulled live from the game. Falls back to manual /assign entries otherwise.

const { ChannelType } = require('discord.js');
const fetch = require('node-fetch');
const storage = require('../database/storage');

const LOCO_FETCH_TIMEOUT_MS = 2000;

// ==== MONOSPACED TABLE ====

function pad(str, len) {
  str = String(str ?? '');
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function buildMonospacedTable(rows) {
  if (!rows.length) return '';
  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map(r => String(r[i] ?? '').length))
  );
  return rows
    .map(row => row.map((cell, i) => pad(cell ?? '', widths[i])).join(' | '))
    .join('\n');
}

// ==== LIVE LOCO DATA ====

function normalizeLoco(id) {
  return String(id ?? '').toLowerCase().trim();
}

/**
 * Tries to match a crew member's train number to a loco returned by GRDNConnect.
 * Exact match first, then suffix match (crew enters "001", game returns "DE2-001").
 */
function findLoco(locoMap, trainNumber) {
  if (!locoMap || !locoMap.size) return null;
  const norm = normalizeLoco(trainNumber);
  if (locoMap.has(norm)) return locoMap.get(norm);
  for (const [id, data] of locoMap) {
    if (id.endsWith(norm) || norm.endsWith(id)) return data;
  }
  return null;
}

/**
 * Fetches /locos from GRDNConnect and returns a Map<normalizedLocoId, locoData>.
 * Returns null if there's no DV URL, no active session, or the fetch fails.
 */
async function fetchLocoMap(guildId) {
  try {
    const dvUrl = storage.getDvBaseUrl();
    if (!dvUrl) {
      console.log('[TrainBoard] fetchLocoMap: no DV URL set in DB — skipping fetch');
      return null;
    }

    const session = storage.getActiveSession(guildId);
    if (!session) {
      console.log('[TrainBoard] fetchLocoMap: no active session for guild', guildId);
      return null;
    }

    const url = `${dvUrl}/locos`;
    console.log('[TrainBoard] fetchLocoMap: fetching', url);

    const res = await fetch(url, { timeout: LOCO_FETCH_TIMEOUT_MS });
    if (!res.ok) {
      console.log('[TrainBoard] fetchLocoMap: HTTP', res.status, 'from', url);
      return null;
    }

    const locos = await res.json();
    console.log('[TrainBoard] fetchLocoMap: got', locos.length, 'loco(s):', locos.map(l => l.locoId).join(', ') || '(none)');

    const map = new Map();
    for (const loco of locos) {
      map.set(normalizeLoco(loco.locoId), loco);
    }
    return map;
  } catch (err) {
    console.error('[TrainBoard] fetchLocoMap error:', err.message);
    return null;
  }
}

// ==== TRAIN BOARD UPDATE ====

async function updateTrainBoard(client, guildId, channelId) {
  const guild   = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const crew     = storage.getAllCrew(guildId);
  const filtered = crew.filter(
    c => c.type && c.trainNumber && c.type.toLowerCase() !== 'dispatcher'
  );

  // Group by crew type
  const byType = new Map();
  for (const c of filtered) {
    const key = c.type.toUpperCase();
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key).push(c);
  }
  for (const list of byType.values()) {
    list.sort((a, b) => String(a.trainNumber).localeCompare(String(b.trainNumber)));
  }

  // Attempt live loco-to-job data from GRDNConnect
  const locoMap = await fetchLocoMap(guildId);

  const descriptionParts = [];

  for (const [type, list] of byType) {
    descriptionParts.push(`**${type}**`);

    const rows = [['#', 'DEP', 'DES', 'TRK', 'JOB', 'RMK']];

    for (const c of list) {
      const liveData = findLoco(locoMap, c.trainNumber);

      if (liveData && liveData.jobs && liveData.jobs.length > 0) {
        // Live game data — one row per job on this loco
        for (let i = 0; i < liveData.jobs.length; i++) {
          const j = liveData.jobs[i];
          rows.push([
            i === 0 ? c.trainNumber : '',   // loco # only on the first row
            j.departure   ?? '—',
            j.destination ?? '—',
            '—',
            j.jobId       ?? '—',
            '—'
          ]);
        }
      } else {
        // No live data — fall back to manual /assign entry
        const assign = storage.getAssignmentByTrain(guildId, c.trainNumber);
        rows.push([
          c.trainNumber,
          assign?.dep || '—',
          assign?.des || '—',
          assign?.trk || '—',
          assign?.job || '—',
          assign?.rmk || '—'
        ]);
      }
    }

    descriptionParts.push('```text\n' + buildMonospacedTable(rows) + '\n```');
  }

  if (descriptionParts.length === 0) {
    descriptionParts.push('_No active trains._');
  }

  const embed = {
    title: '🚆 TRAIN BOARD',
    description: descriptionParts.join('\n\n'),
    timestamp: new Date().toISOString(),
  };

  // Sticky: edit the existing pinned message, or post a new one
  let messageId = storage.getTrainBoardMessageId(guildId);
  let message   = null;

  if (messageId) {
    try { message = await channel.messages.fetch(messageId); }
    catch { message = null; }
  }

  if (message) {
    await message.edit({ embeds: [embed] });
  } else {
    const sent = await channel.send({ embeds: [embed] });
    storage.setTrainBoardMessageId(guildId, sent.id);
  }
}

module.exports = { updateTrainBoard };
