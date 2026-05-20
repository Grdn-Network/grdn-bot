// commands/ops/syncop.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js'); // EmbedBuilder used for log embed
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const db = require('../../database/db');
const storage = require('../../database/storage');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE, DISPATCH_QUAL_ROLE, DISPATCH_CHANNEL_ID, TRAIN_BOARD_CHANNEL_ID } = require('../../config');
const { sendLog } = require('../../logging/logHelper');
const loggingConfig = require('../../config/logging.json');
const { updateTrainBoard } = require('../../utils/trainBoard');
const { buildDispatchEmbed } = require('../../utils/dispatchEmbed');

const FETCH_TIMEOUT_MS = 5000;
const TUNNELS_FILE = path.join(__dirname, '..', '..', 'host-tunnels.json');

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

    // Rebuild the live embed from DB state (preserves all static sections)
    const embedRow = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
    if (!embedRow) return '✅ DB updated — no embed posted yet (run `/operembed`).';

    const channel = guild.channels.cache.get(DISPATCH_CHANNEL_ID);
    if (!channel) return '✅ DB updated — dispatch channel not found.';

    const msg = await channel.messages.fetch(embedRow.message_id).catch(() => null);
    if (!msg) return '✅ DB updated — embed message not found (run `/operembed`).';

    await msg.edit({ embeds: [buildDispatchEmbed()], components: msg.components });

    return `✅ Embed updated — **${serverName}** | ${rdLink}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('syncop')
        .setDescription('Start an official ops session — syncs server info from GRDNConnect (requires Cloudflare tunnel).'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, DISPATCH_QUAL_ROLE])) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        await interaction.deferReply({ flags: 64 });

        const guild = interaction.guild;
        const now = Date.now();

        // Open a new official ops session
        storage.openSession(guild.id, interaction.user.id, now, 'official');

        // Pull server info from GRDNConnect and update the dispatch embed
        const embedStatus = await syncEmbedFromMod(guild, interaction.user.id);

        // Log to bot log channel
        const logEmbed = new EmbedBuilder()
            .setTitle('🟢 Official Ops Session Opened')
            .setColor(0x57f287)
            .addFields(
                { name: 'Started by', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Dispatch', value: embedStatus, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'GRDN Ops' });

        sendLog(interaction.client, loggingConfig.logChannel, logEmbed);

        // Rebuild train board now that the session is open
        updateTrainBoard(interaction.client, guild.id, TRAIN_BOARD_CHANNEL_ID)
            .catch(err => console.error('[TrainBoard] syncop update failed:', err));

        return interaction.editReply({
            content:
                `✅ Official ops session open.\n` +
                `• Crew: run **/setcrew** with your **train number** to join\n` +
                `• Dispatch embed: ${embedStatus}`
        });
    }
};
