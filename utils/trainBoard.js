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
 * Formats a loco display ID for the train board.
 * Strips the generic "L-" prefix from the game ID and replaces it with the
 * actual type designator when available.
 *
 * Examples:
 *   "L-034" + "LocoDE2"  → "DE2-034"
 *   "L-034" + null       → "034"
 *   "DE2-034" + "LocoDE2"→ "DE2-034"  (already formatted)
 */
// Maps DV's internal TrainCarType enum names → GRDN designators.
// Confirmed against Assembly-CSharp.dll TrainCarType enum reflection.
const DV_LOCO_TYPE_MAP = {
    // DE2 (Shunter)
    'shunter':          'DE2',   // LocoShunter — pre-1.0 enum name
    'locoshunter':      'DE2',
    'de2':              'DE2',

    // DE6 — enum value is "LocoDiesel", NOT "LocoDE6"
    'diesel':           'DE6',
    'locodiesel':       'DE6',
    'de6':              'DE6',
    'de6slug':          'DE6S',  // LocoDE6Slug
    'locode6slug':      'DE6S',

    // DH4
    'dh4':              'DH4',
    'locodh4':          'DH4',

    // DM3
    'dm3':              'DM3',
    'locodm3':          'DM3',

    // S060
    's060':             'S060',
    'locos060':         'S060',

    // S282 — enum value is "LocoSteamHeavy"
    's282':             'S282',
    'steamheavy':       'S282',
    'locosteamheavy':   'S282',
    'tender':           'S282T', // Tender car for S282

    // BE2 (Microshunter) — enum value is "LocoMicroshunter"
    'be2':              'BE2',
    'microshunter':     'BE2',
    'locomicroshunter': 'BE2',

    // DM1U (Railbus)
    'railbus':          'DM1U',
    'locorailbus':      'DM1U',
    'dm1u':             'DM1U',
    'locodm1u':         'DM1U',

    // Handcar
    'handcar':          'HC',
};

function formatLocoId(locoId, locoType) {
  // Pull just the numeric/suffix part after the last hyphen (e.g. "L-034" → "034")
  const raw = String(locoId ?? '');
  const numPart = raw.includes('-') ? raw.split('-').pop() : raw;

  if (locoType) {
    // Normalise: strip "Loco" prefix, lowercase, look up in map
    const stripped = locoType.replace(/^Loco/i, '');
    const typePart = DV_LOCO_TYPE_MAP[stripped.toLowerCase()]
                  || DV_LOCO_TYPE_MAP[locoType.toLowerCase()]
                  || stripped;
    if (typePart) return `${typePart}-${numPart}`;
  }

  return numPart;
}

/**
 * Tries to match a crew member's train number (+ optional loco type) to a loco
 * returned by GRDNConnect.
 *
 * Priority:
 *   1. Exact key match on full normalised ID
 *   2. If locoType is set: find a loco whose game ID or locoType field contains
 *      the type string AND whose ID ends with the train number
 *   3. Number-only suffix fuzzy match (fallback — e.g. "001" → "de2 001")
 */
function findLoco(locoMap, trainNumber, locoType) {
  if (!locoMap || !locoMap.size) return null;
  const normNum  = normalizeLoco(trainNumber);
  const normType = locoType ? normalizeLoco(locoType) : null;

  // Pass 1: exact key
  if (locoMap.has(normNum)) return locoMap.get(normNum);

  // Pass 2: type-aware match (only when crew has a loco type set)
  if (normType) {
    for (const [id, data] of locoMap) {
      const typeHit = id.includes(normType) ||
                      normalizeLoco(data.locoType ?? '').includes(normType);
      const numHit  = id.endsWith(normNum);
      if (typeHit && numHit) return data;
    }
  }

  // Pass 3: number-only fuzzy fallback
  for (const [id, data] of locoMap) {
    if (id.endsWith(normNum) || normNum.endsWith(id)) return data;
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
      const liveData = findLoco(locoMap, c.trainNumber, c.locoType);

      // Build the display ID for the # column.
      // Live data: use game locoId + game locoType to format (e.g. "DE2-034")
      // No live data: use profile loco_type + train number, or bare number
      const displayId = liveData
        ? formatLocoId(liveData.locoId, liveData.locoType)        // e.g. "DE2-034"
        : c.locoType
          ? `${c.locoType}-${c.trainNumber}`                       // e.g. "DE2-001" from profile
          : c.trainNumber;                                         // e.g. "001"

      // Manual /assign takes priority over live data.
      // If all fields are '—' (or no entry exists), hand back to GRDNConnect.
      const assign   = storage.getAssignmentByTrain(guildId, c.trainNumber);
      const hasManual = assign && [assign.dep, assign.des, assign.trk, assign.job, assign.rmk]
        .some(v => v && v !== '—');

      if (hasManual) {
        // Manual override — show exactly what /assign saved
        rows.push([
          displayId,
          assign.dep || '—',
          assign.des || '—',
          assign.trk || '—',
          assign.job || '—',
          assign.rmk || '—',
        ]);
      } else if (liveData && liveData.jobs && liveData.jobs.length > 0) {
        // No manual override — use live GRDNConnect data
        for (let i = 0; i < liveData.jobs.length; i++) {
          const j = liveData.jobs[i];
          // Prefix ! when job is not yet accepted so crew can see it's unassigned
          const jobDisplay = j.state === 'InProgress'
            ? (j.jobId ?? '—')
            : `!${j.jobId ?? '—'}`;
          rows.push([
            i === 0 ? displayId : '',
            j.departure   ?? '—',
            j.destination ?? '—',
            j.track       ?? '—',
            jobDisplay,
            j.cargo       ?? '—',
          ]);
        }
      } else {
        // Neither manual nor live data
        rows.push([displayId, 'XXX', 'XXX', 'XXX', 'XXX', 'XXX']);
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
