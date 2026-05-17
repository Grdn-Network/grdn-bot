// logging/inviteTracker.js
// Tracks which invite a member used when joining.
// Requires the bot to have Manage Server permission.
const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const { sendLog } = require('./logHelper');

// guild_id -> Map(invite_code -> invite snapshot)
const inviteCache = new Map();

function snapshotInvites(invites) {
    return new Map(invites.map(i => [i.code, { uses: i.uses, maxUses: i.maxUses, inviter: i.inviter }]));
}

module.exports = (client) => {
    // Cache all invites once the bot is ready
    client.once('ready', async () => {
        for (const [, guild] of client.guilds.cache) {
            try {
                const invites = await guild.invites.fetch();
                inviteCache.set(guild.id, snapshotInvites(invites));
            } catch {
                // Bot may lack Manage Server permission
            }
        }
    });

    // Keep cache up to date as invites are created/deleted
    client.on('inviteCreate', invite => {
        try {
            const cache = inviteCache.get(invite.guild.id) ?? new Map();
            cache.set(invite.code, { uses: invite.uses, maxUses: invite.maxUses, inviter: invite.inviter });
            inviteCache.set(invite.guild.id, cache);
        } catch {}
    });

    client.on('inviteDelete', invite => {
        try {
            inviteCache.get(invite.guild.id)?.delete(invite.code);
        } catch {}
    });

    client.on('guildMemberAdd', async member => {
        try {
            const cached = inviteCache.get(member.guild.id) ?? new Map();
            const current = await member.guild.invites.fetch().catch(() => null);

            if (!current) return;

            // Find invite whose use count increased
            let usedCode = null;
            let usedInviter = null;
            let usedUses = null;

            for (const [code, inv] of current) {
                const snap = cached.get(code);
                if (snap && inv.uses > snap.uses) {
                    usedCode = code;
                    usedInviter = inv.inviter;
                    usedUses = inv.uses;
                    break;
                }
            }

            // Handle single-use invites that are now deleted
            if (!usedCode) {
                for (const [code, snap] of cached) {
                    if (!current.has(code) && snap.maxUses === 1 && snap.uses === 0) {
                        usedCode = code;
                        usedInviter = snap.inviter;
                        usedUses = 1;
                        break;
                    }
                }
            }

            // Update cache with latest snapshot
            inviteCache.set(member.guild.id, snapshotInvites(current));

            const embed = new EmbedBuilder()
                .setTitle('📨 Member Joined')
                .setColor(0x55ff55)
                .addFields(
                    { name: 'User', value: `${member.user} (${member.user.tag})`, inline: true },
                    { name: 'Account Age', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Invite Code', value: usedCode ?? 'Unknown', inline: true },
                    { name: 'Invited By', value: usedInviter ? `${usedInviter} (${usedInviter.tag})` : 'Unknown', inline: true },
                    { name: 'Invite Uses', value: usedUses != null ? String(usedUses) : 'Unknown', inline: true }
                )
                .setTimestamp();

            sendLog(client, config.logChannel, embed);
        } catch (err) {
            console.error('[inviteTracker] Error:', err);
        }
    });
};
