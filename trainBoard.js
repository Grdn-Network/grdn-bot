// trainBoard.js
// Assumes discord.js v14

const { ChannelType, PermissionFlagsBits } = require('discord.js');

// ==== STORAGE INTERFACE ====
// getAllCrew(): returns array of { userId, type, trainNumber }
// getAssignmentByTrain(trainNumber): returns { dep, des, trk, job, rmk } or null
// setAssignment(trainNumber, data): upsert assignment
// getTrainBoardMessageId(guildId): string | null
// setTrainBoardMessageId(guildId, messageId): void

const storage = require('./storage'); // your implementation

// ==== MONOSPACED TABLE ====

function pad(str, len) {
  str = String(str ?? '');
  if (str.length >= len) return str;
  return str + ' '.repeat(len - str.length);
}

function buildMonospacedTable(rows) {
  if (!rows.length) return '';
  const cols = rows[0].length;
  const widths = new Array(cols).fill(0);

  for (const row of rows) {
    row.forEach((cell, i) => {
      const len = String(cell ?? '').length;
      if (len > widths[i]) widths[i] = len;
    });
  }

  return rows
    .map(row =>
      row
        .map((cell, i) => pad(cell ?? '', widths[i]))
        .join(' | ')
    )
    .join('\n');
}

// ==== TRAIN BOARD UPDATE ====

async function updateTrainBoard(client, guildId, channelId) {
  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const crew = await storage.getAllCrew(guildId);
  // Filter: must have type + trainNumber, and not Dispatch
  const filtered = crew.filter(
    c =>
      c.type &&
      c.trainNumber &&
      c.type.toLowerCase() !== 'dispatcher'
  );

  // Group by type
  const byType = new Map();
  for (const c of filtered) {
    const key = c.type.toUpperCase();
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key).push(c);
  }

  // Sort each group by trainNumber (string compare)
  for (const [type, list] of byType) {
    list.sort((a, b) => String(a.trainNumber).localeCompare(String(b.trainNumber)));
  }

  let descriptionParts = [];

  for (const [type, list] of byType) {
    descriptionParts.push(`**${type}**`);

    const rows = [];
    // Header
    rows.push(['#', 'DEP', 'DES', 'TRK', 'JOB', 'RMK']);

    for (const c of list) {
      const assign = await storage.getAssignmentByTrain(guildId, c.trainNumber);
      rows.push([
        c.trainNumber,
        assign?.dep || '—',
        assign?.des || '—',
        assign?.trk || '—',
        assign?.job || '—',
        assign?.rmk || '—'
      ]);
    }

    const table = buildMonospacedTable(rows);
    descriptionParts.push('```text\n' + table + '\n```');
  }

  if (descriptionParts.length === 0) {
    descriptionParts.push('_No active trains._');
  }

  const embed = {
    title: '🚆 TRAIN BOARD',
    description: descriptionParts.join('\n\n'),
    timestamp: new Date().toISOString(),
  };

  // Sticky behavior: edit existing message if possible
  let messageId = await storage.getTrainBoardMessageId(guildId);
  let message = null;

  if (messageId) {
    try {
      message = await channel.messages.fetch(messageId);
    } catch {
      message = null;
    }
  }

  if (message) {
    await message.edit({ embeds: [embed] });
  } else {
    const sent = await channel.send({ embeds: [embed] });
    await storage.setTrainBoardMessageId(guildId, sent.id);
  }
}

module.exports = {
  updateTrainBoard,
};