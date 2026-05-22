// commands/admin/purgeuser.js
// Two modes:
//
//   /purgeuser ban @user
//     Deletes recent messages across all channels, then bans the user.
//     Removes their crew registration. Nuclear option — admin only.
//
//   /purgeuser messages @user timeframe:[1h|6h|24h|3d|7d] [channel:#channel]
//     Deletes this user's messages within the chosen timeframe. No ban.
//     Optionally scoped to a single channel. Admin only.

const { SlashCommandBuilder, ChannelType } = require('discord.js');
const storage = require('../../database/storage');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE } = require('../../config');

// Maps choice values → milliseconds
const TIMEFRAMES = {
    '1h':  1  * 60 * 60 * 1000,
    '6h':  6  * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '3d':  3  * 24 * 60 * 60 * 1000,
    '7d':  7  * 24 * 60 * 60 * 1000,
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purgeuser')
        .setDescription('Delete messages from a user, with optional ban.')

        // ── /purgeuser ban ────────────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName('ban')
               .setDescription('Purge recent messages across all channels, then ban the user.')
               .addUserOption(opt =>
                   opt.setName('user')
                      .setDescription('User to purge and ban')
                      .setRequired(true)
               )
        )

        // ── /purgeuser messages ───────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName('messages')
               .setDescription("Delete a user's messages within a timeframe. No ban.")
               .addUserOption(opt =>
                   opt.setName('user')
                      .setDescription('User to target')
                      .setRequired(true)
               )
               .addStringOption(opt =>
                   opt.setName('timeframe')
                      .setDescription('How far back to search')
                      .setRequired(true)
                      .addChoices(
                          { name: 'Last 1 hour',   value: '1h'  },
                          { name: 'Last 6 hours',  value: '6h'  },
                          { name: 'Last 24 hours', value: '24h' },
                          { name: 'Last 3 days',   value: '3d'  },
                          { name: 'Last 7 days',   value: '7d'  },
                      )
               )
               .addChannelOption(opt =>
                   opt.setName('channel')
                      .setDescription('Limit to one channel (default: all channels)')
                      .addChannelTypes(ChannelType.GuildText)
               )
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, ADMIN_ROLE)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64,
            });
        }

        const sub = interaction.options.getSubcommand();
        if (sub === 'ban')      return handleBan(interaction);
        if (sub === 'messages') return handleMessages(interaction);
    },
};

// ── /purgeuser ban ────────────────────────────────────────────────────────────

async function handleBan(interaction) {
    const target = interaction.options.getUser('user');
    const guild  = interaction.guild;

    await interaction.reply({
        content: `🔄 Purging messages from **${target.username}**…`,
        flags: 64,
    });

    let deletedCount = 0;

    for (const [, channel] of guild.channels.cache) {
        if (!channel.isTextBased()) continue;
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            const targets  = messages.filter(msg => msg.author?.id === target.id);
            for (const msg of targets.values()) {
                await msg.delete().catch(() => {});
                deletedCount++;
            }
        } catch {
            // Skip channels the bot cannot access
        }
    }

    await guild.members.ban(target.id, {
        reason: `Purged and banned by ${interaction.user.tag}`,
    });

    storage.removeCrew(target.id);

    interaction.client.emit('purgeUser', {
        moderator: interaction.user,
        target,
        deletedCount,
    });

    return interaction.editReply({
        content:
            `✅ Banned **${target.username}**.\n` +
            `• Messages deleted: **${deletedCount}**\n` +
            `• Crew registration removed.`,
    });
}

// ── /purgeuser messages ───────────────────────────────────────────────────────

async function handleMessages(interaction) {
    const target      = interaction.options.getUser('user');
    const timeframeKey = interaction.options.getString('timeframe');
    const limitChannel = interaction.options.getChannel('channel');
    const guild       = interaction.guild;

    const cutoff = Date.now() - TIMEFRAMES[timeframeKey];

    const scope = limitChannel ? `in ${limitChannel}` : 'across all channels';
    await interaction.reply({
        content: `🔄 Scanning for **${target.username}**'s messages in the last **${timeframeKey}** ${scope}…`,
        flags: 64,
    });

    // Build channel list
    const channels = limitChannel
        ? [limitChannel]
        : [...guild.channels.cache.values()].filter(ch => ch.isTextBased());

    let deletedCount = 0;
    let failedCount  = 0;

    for (const channel of channels) {
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            const targets  = messages.filter(msg =>
                msg.author?.id === target.id &&
                msg.createdTimestamp >= cutoff
            );

            if (targets.size === 0) continue;

            if (targets.size >= 2) {
                // bulkDelete handles up to 100; filterOld:true silently skips anything
                // older than 14 days (won't apply here since max timeframe is 7 days)
                const deleted = await channel.bulkDelete(targets, true).catch(() => null);
                deletedCount += deleted?.size ?? 0;
            } else {
                // bulkDelete requires 2+ — delete the single message individually
                for (const msg of targets.values()) {
                    const ok = await msg.delete().then(() => true).catch(() => false);
                    if (ok) deletedCount++;
                    else failedCount++;
                }
            }
        } catch {
            // Skip channels the bot cannot access
        }
    }

    const failNote = failedCount > 0 ? ` (${failedCount} could not be deleted)` : '';
    return interaction.editReply({
        content:
            `✅ Deleted **${deletedCount}** message${deletedCount !== 1 ? 's' : ''} ` +
            `from **${target.username}** — last **${timeframeKey}** ${scope}.${failNote}`,
    });
}
