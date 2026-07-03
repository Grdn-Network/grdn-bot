// events/scamScanner.js
// Anti-scam message scanner. NEWCOMER role is the trust boundary; frequency
// (same message bursting across channels within a minute) escalates to high.
// See grdn-bot issue #3.
//
// Tiers (newcomers):
//   medium: a link anywhere, or media outside the whitelisted channels
//           (#media / #off-topic). Delete + short timeout + hold for reinstate + alert.
//   high:   scam text, mentions/pings, or a burst (same message across >=2
//           channels within a minute). Delete all copies + long timeout + hold + alert.
// Non-newcomers are only caught by the burst / @everyone path (compromised
// established accounts). Staff are skipped while STAFF_EXEMPT is true.
// Every moderation action DMs the user a reassurance that an admin is reviewing
// it and it will be restored if nothing is wrong.

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const config = require('../config');
const storage = require('../database/storage');
const { hasAnyRole } = require('../utils/permissions');

const {
    SCAM_MODERATION_ENABLED, NEWCOMER_ROLE, STAFF_ROLES, STAFF_EXEMPT,
    MEDIA_CHANNELS, LFG_ROLE, SCAM_ALERT_CHANNEL, SCAM_ALERT_ROLE,
    SCAM_TIMEOUT_SHORT_MS, SCAM_TIMEOUT_LONG_MS,
    SCAM_BURST_WINDOW_MS, SCAM_BURST_THRESHOLD,
} = config;

const LINK_RE = /(https?:\/\/|www\.|discord\.gg\/|discord\.com\/invite\/|t\.me\/|\b[a-z0-9-]+\.(?:com|net|org|io|gg|xyz|ru|top|link|shop|store)\b)/i;
const SCAM_RE = /(free\s*(?:nitro|robux|vbucks)|nitro\s*(?:gift|free|giveaway)|steam\s*(?:gift|community)|gift\s*card|air[\s-]?drop|claim\s*(?:your|reward|prize|nitro)|mr\s*beast|onlyfans|18\s*\+|\bteen\b)/i;

// Rolling buffer for burst detection: { userId, hash, channelId, messageId, ts }
const recent = [];

function hashContent(msg) {
    const text = (msg.content || '').trim().toLowerCase();
    const att = [...msg.attachments.values()].map(a => a.name || a.url).join('|');
    return `${text}::${att}`;
}

module.exports = (client) => {
    client.on('messageCreate', async (message) => {
        try {
            const dbFlag = storage.isModerationEnabled();
            const enabled = dbFlag === null ? SCAM_MODERATION_ENABLED : dbFlag;
            if (!enabled) return;
            if (!message.guild || message.author?.bot || message.system) return;

            const member = message.member;
            if (!member) return;

            if (STAFF_EXEMPT && hasAnyRole(member, STAFF_ROLES)) return;

            const isNewcomer = hasAnyRole(member, NEWCOMER_ROLE);

            // ── signals ──────────────────────────────────────────────────
            const content = message.content || '';
            const hasLink = LINK_RE.test(content);
            const hasScam = SCAM_RE.test(content);
            const hasImage = message.attachments.some(a =>
                a.contentType?.startsWith('image') || /\.(png|jpe?g|gif|webp)$/i.test(a.name || a.url || '')
            );
            const hasAttachment = message.attachments.size > 0;
            const mentionsEveryone = message.mentions.everyone;
            const mentionsRolesOrUsers =
                message.mentions.roles.size > 0 || message.mentions.users.size > 0;
            const mentionsLfg = message.mentions.roles.has(LFG_ROLE) || content.includes(`<@&${LFG_ROLE}>`);
            const inMediaChannel = MEDIA_CHANNELS.includes(message.channelId);

            // ── burst detection ──────────────────────────────────────────
            const now = Date.now();
            const hash = hashContent(message);
            while (recent.length && now - recent[0].ts > SCAM_BURST_WINDOW_MS) recent.shift();
            recent.push({ userId: message.author.id, hash, channelId: message.channelId, messageId: message.id, ts: now });
            const sameContent = recent.filter(r => r.userId === message.author.id && r.hash === hash);
            const distinctChannels = new Set(sameContent.map(r => r.channelId));
            const isBurst = distinctChannels.size >= SCAM_BURST_THRESHOLD;

            // ── tier decision ────────────────────────────────────────────
            let tier = null; // 'low' | 'medium' | 'high'
            const reasons = [];

            if (isBurst) {
                tier = 'high';
                reasons.push(`same message across ${distinctChannels.size} channels within ${SCAM_BURST_WINDOW_MS / 1000}s`);
            }
            if (mentionsEveryone && (hasLink || hasScam)) {
                tier = 'high';
                reasons.push('@everyone/@here with link or scam text');
            }

            if (isNewcomer) {
                if (!tier && (hasScam || mentionsEveryone || mentionsLfg || mentionsRolesOrUsers)) {
                    tier = 'high';
                    if (hasScam) reasons.push('scam keyword');
                    if (mentionsEveryone) reasons.push('@everyone/@here');
                    else if (mentionsLfg) reasons.push('@lfg mention');
                    else if (mentionsRolesOrUsers) reasons.push('role/user ping');
                }
                if (!tier && hasLink) { tier = 'medium'; reasons.push('link from newcomer'); }
                if (!tier && hasAttachment && !inMediaChannel) {
                    tier = 'medium';
                    reasons.push(hasImage ? 'image outside media/off-topic' : 'attachment outside media/off-topic');
                }
            }

            if (!tier) return;

            await handleDetection({ client, message, member, tier, reasons, sameContent, hasImage });
        } catch (err) {
            console.error('[scamScanner] error:', err);
        }
    });
};

async function handleDetection({ client, message, member, tier, reasons, sameContent, hasImage }) {
    const guild = message.guild;
    const reasonText = reasons.join(', ');

    // Snapshot before any deletion
    const attachments = [...message.attachments.values()].map(a => ({ url: a.url, name: a.name }));
    const contentSnapshot = message.content || '';

    let heldId = null;
    let timeoutMs = 0;

    if (tier === 'medium' || tier === 'high') {
        timeoutMs = tier === 'high' ? SCAM_TIMEOUT_LONG_MS : SCAM_TIMEOUT_SHORT_MS;

        // Delete the offending message (all burst copies on high)
        const toDelete = tier === 'high'
            ? sameContent.map(r => ({ channelId: r.channelId, messageId: r.messageId }))
            : [{ channelId: message.channelId, messageId: message.id }];
        await deleteMessages(guild, toDelete);

        await member.timeout(timeoutMs, `Auto-moderation (${tier}): ${reasonText}`).catch(err =>
            console.error('[scamScanner] timeout failed:', err.message));

        heldId = storage.addHeldMessage({
            guildId: guild.id,
            userId: member.id,
            channelId: message.channelId,
            content: contentSnapshot,
            attachments,
            tier,
            reason: reasonText,
        });

        await notifyUser(member, message.channel, reasonText, timeoutMs);
    }

    await sendAdminAlert({ client, member, message, tier, reasonText, heldId, hasImage, attachments, contentSnapshot });
}

async function deleteMessages(guild, refs) {
    for (const ref of refs) {
        try {
            const channel = guild.channels.cache.get(ref.channelId);
            if (!channel?.isTextBased?.()) continue;
            const msg = await channel.messages.fetch(ref.messageId).catch(() => null);
            if (msg) await msg.delete().catch(() => {});
        } catch {
            // ignore
        }
    }
}

async function notifyUser(member, channel, reasonText, timeoutMs) {
    const mins = Math.round(timeoutMs / 60000);
    const dur = mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`;
    const dm =
        `Your message in ${member.guild.name} (#${channel.name}) was automatically held and you were ` +
        `temporarily timed out for ${dur}.\n\n` +
        `Reason: ${reasonText}.\n\n` +
        `This is an automated anti-scam measure, not a manual punishment. An admin has already been ` +
        `notified and is reviewing it right now. If nothing is wrong, your message will be restored and ` +
        `your timeout removed. Sorry for the interruption, and thanks for your patience.`;
    try {
        await member.send(dm);
    } catch {
        // DMs closed: brief auto-deleting in-channel note as a fallback
        channel.send({
            content: `<@${member.id}> your message was automatically held for review. An admin has been notified, and if nothing is wrong it will be restored shortly.`,
            allowedMentions: { users: [member.id] },
        })
            .then(m => setTimeout(() => m.delete().catch(() => {}), 30000))
            .catch(() => {});
    }
}

async function sendAdminAlert({ client, member, message, tier, reasonText, heldId, hasImage, attachments, contentSnapshot }) {
    const alertChannel = client.channels.cache.get(SCAM_ALERT_CHANNEL);
    if (!alertChannel) return;

    const color = tier === 'high' ? 0xff0000 : tier === 'medium' ? 0xffaa00 : 0xffee55;
    const embed = new EmbedBuilder()
        .setTitle(`🛡️ Scam scanner: ${tier.toUpperCase()} confidence`)
        .setColor(color)
        .addFields(
            { name: 'User', value: `${member} (${member.user.tag})`, inline: true },
            { name: 'Account age', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
            { name: 'Reason', value: reasonText || 'n/a', inline: false },
        )
        .setFooter({ text: heldId ? 'Message removed and user timed out. Reinstate to undo both.' : 'Nothing removed. Heads-up only.' })
        .setTimestamp();

    if (contentSnapshot) embed.addFields({ name: 'Message', value: contentSnapshot.slice(0, 1000) });
    if (attachments.length) {
        embed.addFields({ name: 'Attachments', value: attachments.map(a => a.name || a.url).slice(0, 5).join('\n').slice(0, 1000) });
        if (hasImage) embed.setImage(attachments[0].url);
    }

    const row = new ActionRowBuilder();
    if (heldId) {
        row.addComponents(
            new ButtonBuilder().setCustomId(`scam_reinstate:${heldId}`).setLabel('Approve & Reinstate').setStyle(ButtonStyle.Success).setEmoji('✅'),
        );
    }
    row.addComponents(
        new ButtonBuilder().setCustomId(`scam_purge:${member.id}`).setLabel('Purge User').setStyle(ButtonStyle.Danger).setEmoji('🧹'),
        new ButtonBuilder().setCustomId(`scam_dismiss:${heldId ?? 0}`).setLabel('Dismiss').setStyle(ButtonStyle.Secondary).setEmoji('👌'),
    );

    await alertChannel.send({
        content: `<@&${SCAM_ALERT_ROLE}>`,
        embeds: [embed],
        components: [row],
        allowedMentions: { roles: [SCAM_ALERT_ROLE] },
    }).catch(err => console.error('[scamScanner] alert failed:', err.message));
}
