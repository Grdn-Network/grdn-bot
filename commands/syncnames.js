// commands/syncnames.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const db = require('../database/db');
const storage = require('../storage');
const { buildNickname } = require('../utils/nickname');
const { hasAnyRole } = require('../utils/permissions');
const { ADMIN_ROLE, DISPATCH_QUAL_ROLE, DISPATCH_CHANNEL_ID } = require('../config');

const FETCH_TIMEOUT_MS = 5000;
const TUNNELS_FILE = path.join(__dirname, '..', 'host-tunnels.json');

/**
 * Returns the tunnel subdomain for a Discord user ID, or null if not registered.
 * Re-reads the file each time so edits on the VPS take effect without a restart.
 */
function getHostSubdomain(userId) {
    try {
        const raw = fs.readFileSync(TUNNELS_FILE, 'utf8');
        const map = JSON.parse(raw);
        return map[userId] ?? null;
    } catch {
        return null;
    }
}

/**
 * Fetches server info from GRDNConnect and updates the dispatch embed.
 * Returns a short status string to append to the sync reply.
 */
async function syncEmbedFromMod(guild, userId) {
    const subdomain = getHostSubdomain(userId);
    if (!subdomain) return '⚠️ No tunnel registered for you — add your ID to host-tunnels.json.';

    const connectUrl = `https://${subdomain}-connect.grdnnetwork.com`;
    const rdLink = `${subdomain}.grdnnetwork.com`;

    // Update the global DV URL to this host's connect URL for the session
    storage.setDvUrl(connectUrl);

    let serverName, password;
    try {
        const res = await fetch(`${connectUrl}/server-info`, { timeout: FETCH_TIMEOUT_MS });
        if (!res.ok) return '⚠️ GRDNConnect responded with an error — embed not updated.';
        const data = await res.json();
        serverName = data.serverName;
        password = data.password;
    } catch {
        return '⚠️ Could not reach GRDNConnect — is the game running?';
    }

    if (!serverName && !password) return '⚠️ GRDNConnect returned no server info — is DVMP running?';

    // Update DB
    db.prepare(`
        INSERT OR IGNORE INTO dispatch_settings (id, server_name, server_password, remote_link, remote_password)
        VALUES (1, 'Not set', 'Not set', 'Not set', 'Not set')
    `).run();

    if (serverName) db.prepare(`UPDATE dispatch_settings SET server_name = ? WHERE id = 1`).run(serverName);
    if (password)   db.prepare(`UPDATE dispatch_settings SET server_password = ? WHERE id = 1`).run(password);
    db.prepare(`UPDATE dispatch_settings SET remote_link = ? WHERE id = 1`).run(rdLink);

    // Fetch and update the live embed
    const embedRow = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
    if (!embedRow) return '✅ DB updated — no embed posted yet (run /postembed).';

    const channel = guild.channels.cache.get(DISPATCH_CHANNEL_ID);
    if (!channel) return '✅ DB updated — dispatch channel not found.';

    const msg = await channel.messages.fetch(embedRow.message_id).catch(() => null);
    if (!msg) return '✅ DB updated — embed message not found (run /postembed).';

    const fieldMap = {
        'Server Name': serverName,
        'Remote Dispatch Link': rdLink,
        ...(password ? { 'Server Password': password } : {})
    };

    const embed = EmbedBuilder.from(msg.embeds[0]);
    const updatedFields = embed.data.fields.map(f =>
        fieldMap[f.name] !== undefined ? { ...f, value: fieldMap[f.name] } : f
    );
    embed.setFields(updatedFields);
    embed.setTimestamp();
    await msg.edit({ embeds: [embed] });

    return `✅ Embed updated — **${serverName}** | ${rdLink}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('syncnames')
        .setDescription('Sync all registered nicknames and open an official ops session.'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, DISPATCH_QUAL_ROLE])) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        await interaction.reply({ content: '🔄 Syncing nicknames and opening ops session…', flags: 64 });

        const guild = interaction.guild;
        const now = Date.now();

        // Open a new ops session — enrolls all crew who have an active role + train number
        const sessionId = storage.openSession(guild.id, interaction.user.id, now);
        const crew = storage.getAllCrew(guild.id);

        let updated = 0;
        let failed = 0;
        let enrolled = 0;

        for (const row of crew) {
            try {
                const member = await guild.members.fetch(row.userId).catch(() => null);
                if (!member) { failed++; continue; }

                const ok = await member.setNickname(
                    buildNickname(row.type, row.trainNumber, row.preferredName)
                ).then(() => true).catch(() => false);

                if (ok) updated++; else failed++;

                // Only enroll in ops session if they're currently in a voice channel
                if (member.voice.channel) {
                    const category = storage.classifyCategory(row.type, row.trainNumber);
                    if (category) {
                        storage.openOpsEntry(row.userId, guild.id, sessionId, category, now);
                        enrolled++;
                    }
                }
            } catch {
                failed++;
            }
        }

        const embedStatus = await syncEmbedFromMod(guild, interaction.user.id);

        return interaction.followUp({
            content:
                `✅ Sync complete. Ops session open.\n` +
                `• Nicknames updated: **${updated}** | Failed: **${failed}**\n` +
                `• Crew enrolled in session: **${enrolled}**\n` +
                `• Dispatch embed: ${embedStatus}`,
            flags: 64
        });
    }
};
