// commands/ops/endop.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/db');
const storage = require('../../database/storage');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE, DISPATCH_CHANNEL_ID, TRAIN_BOARD_CHANNEL_ID } = require('../../config');
const { deleteAllCrewVCs } = require('../../utils/crewVCManager');
const { sendLog } = require('../../logging/logHelper');
const loggingConfig = require('../../config/logging.json');
const { updateTrainBoard } = require('../../utils/trainBoard');
const { buildDispatchEmbed } = require('../../utils/dispatchEmbed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('endop')
        .setDescription('End the official ops session, save hours, and reset crew nicknames.'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE])) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        await interaction.reply({ content: '🔄 Closing ops session and resetting nicknames…', flags: 64 });

        const { reset, failed, sessionClosed } = await module.exports.resetLogic(interaction);

        // Log to bot log channel
        const logEmbed = new EmbedBuilder()
            .setTitle('🔴 Ops Session Closed')
            .setColor(0xed4245)
            .addFields(
                { name: 'Closed by', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Nicknames reset', value: `${reset} reset, ${failed} failed`, inline: true },
                { name: 'Hours', value: sessionClosed ? 'Saved ✓' : 'No active session', inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'GRDN Ops' });

        sendLog(interaction.client, loggingConfig.logChannel, logEmbed);

        // Rebuild train board to reflect cleared state
        updateTrainBoard(interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID)
            .catch(err => console.error('[TrainBoard] endop update failed:', err));

        // Mark op inactive and update the dispatch embed to "no op" state
        try {
            db.prepare(`UPDATE dispatch_settings SET ops_active = 0 WHERE id = 1`).run();
            const embedRow = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
            if (embedRow) {
                const dispatchChannel = interaction.guild.channels.cache.get(DISPATCH_CHANNEL_ID);
                if (dispatchChannel) {
                    const msg = await dispatchChannel.messages.fetch(embedRow.message_id).catch(() => null);
                    if (msg) await msg.edit({ embeds: [buildDispatchEmbed()], components: msg.components });
                }
            }
        } catch (err) {
            console.error('[endop] Embed update failed:', err);
        }

        return interaction.followUp({
            content:
                `✅ Reset complete.\n` +
                `• Nicknames reset: **${reset}** | Failed: **${failed}**\n` +
                `• Ops session: **${sessionClosed ? 'closed — hours saved' : 'no active session'}**`,
            flags: 64
        });
    },

    async resetLogic(interaction) {
        const guild = interaction.guild;
        const now = Date.now();

        // Capture participants BEFORE closing — closeSession deletes session_crew
        const activeSession = storage.getActiveSession(guild.id);
        const participants = activeSession ? storage.getSessionCrew(activeSession.id) : [];

        // Close session — writes hours to ops_log, clears session_crew
        const sessionId = storage.closeSession(guild.id, interaction.user.id, now);

        let reset = 0;
        let failed = 0;

        // Only reset nicknames and train numbers for people who actually joined the op.
        // Everyone else's nickname was never touched, so there's nothing to undo.
        for (const userId of participants) {
            try {
                // Always clear their train number, even if they left mid-session
                storage.clearTrainNumber(userId);

                const crew = storage.getCrewRaw(userId); // null if they left (active = 0)
                const preferredName = crew?.preferred_name ?? null;

                // 10007 = Unknown Member (left server) — soft-remove and skip
                const member = await guild.members.fetch(userId)
                    .catch(err => err.code === 10007 ? null : undefined);
                if (member === null) { storage.removeCrew(userId); continue; }
                if (member === undefined) { failed++; continue; } // fetch error, keep record

                // Discord doesn't allow bots to rename the server owner — skip gracefully
                if (member.id === guild.ownerId) { reset++; continue; }

                const ok = await member.setNickname(preferredName).then(() => true).catch(() => false);
                if (ok) reset++; else failed++;
            } catch {
                failed++;
            }
        }

        storage.clearAllAssignments(guild.id);
        await deleteAllCrewVCs(guild.client, guild.id);

        return { reset, failed, sessionClosed: sessionId !== null };
    }
};
