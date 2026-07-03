// utils/purgedView.js
// Builds one page of the /purged forensic viewer (a summary plus one deleted
// message, with Prev/Next buttons). Shared by the /purged command and the
// purged_nav button handler so both render identically.

const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const storage = require('../database/storage');

const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;
const BOT_ROOT = path.join(__dirname, '..');

// Returns an interaction payload { embeds, files, components } for one page,
// or null if the purge does not exist.
function buildPurgePage(purgeId, index) {
    const purge = storage.getPurgeById(purgeId);
    if (!purge) return null;

    const messages = storage.getPurgeMessages(purgeId);
    const total = messages.length;

    const embed = new EmbedBuilder()
        .setTitle(`Purge of ${purge.target_tag || purge.target_id}`)
        .setColor(0xff5555)
        .addFields(
            { name: 'Banned by', value: purge.moderator_id ? `<@${purge.moderator_id}>` : (purge.moderator_tag || 'unknown'), inline: true },
            { name: 'When', value: `<t:${Math.floor(purge.created_at / 1000)}:f>`, inline: true },
            { name: 'Channels', value: `${purge.channels_affected}`, inline: true },
            { name: 'Reason', value: purge.reason || 'none given', inline: false },
        );

    const files = [];

    if (total === 0) {
        embed.setDescription('No message content was captured for this purge.');
        return { embeds: [embed], files, components: [] };
    }

    const i = Math.max(0, Math.min(index, total - 1));
    const msg = messages[i];
    const atts = msg.attachments || [];

    embed.setDescription(msg.content ? msg.content.slice(0, 2000) : '*(no text)*');
    embed.setFooter({ text: `Message ${i + 1} of ${total} | from #${msg.channel_name || msg.channel_id} | purge #${purgeId}` });
    if (msg.msg_created_at) embed.setTimestamp(msg.msg_created_at);

    if (atts.length) {
        const lines = atts.map(a => (a.url ? `[${a.filename}](${a.url})` : a.filename));
        embed.addFields({ name: `Attachments (${atts.length})`, value: lines.join('\n').slice(0, 1024) });

        // Show the first still-saved image inline; expired ones just show as links above.
        const img = atts.find(a => a.localPath && IMAGE_RE.test(a.filename || ''));
        if (img) {
            const abs = path.join(BOT_ROOT, img.localPath);
            if (fs.existsSync(abs)) {
                const name = path.basename(abs);
                files.push(new AttachmentBuilder(abs, { name }));
                embed.setImage(`attachment://${name}`);
            }
        }
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`purged_nav:${purgeId}:${i - 1}`).setLabel('Prev').setStyle(ButtonStyle.Secondary).setEmoji('◀️').setDisabled(i === 0),
        new ButtonBuilder().setCustomId(`purged_nav:${purgeId}:${i + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setEmoji('▶️').setDisabled(i >= total - 1),
    );

    return { embeds: [embed], files, components: [row] };
}

module.exports = { buildPurgePage };
