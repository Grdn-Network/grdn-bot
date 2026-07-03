// buttons/scamReview.js
// Handles the scam-alert action buttons: Approve & Reinstate, Purge User, Dismiss.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const storage = require('../database/storage');
const { hasAnyRole } = require('../utils/permissions');
const { ADMIN_ROLE, DVMP_COMMAND_ROLE } = require('../config');
const fetch = require('node-fetch');

module.exports = {
    matches: (customId) => customId.startsWith('scam_'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, DVMP_COMMAND_ROLE])) {
            return interaction.reply({ content: '❌ Admins only.', flags: 64 });
        }

        const [action, arg] = interaction.customId.split(':');

        if (action === 'scam_reinstate') return reinstate(interaction, Number(arg));
        if (action === 'scam_purge')     return purge(interaction, arg);
        if (action === 'scam_dismiss')   return dismiss(interaction, Number(arg));
    },
};

async function reinstate(interaction, heldId) {
    const held = storage.getHeldMessage(heldId);
    if (!held) {
        return interaction.reply({
            content: '❌ This held message is no longer available (already handled?).',
            flags: 64,
        });
    }

    await interaction.deferUpdate();

    const guild = interaction.guild;
    const channel = guild.channels.cache.get(held.channel_id);
    const targetMember = await guild.members.fetch(held.user_id).catch(() => null);

    // Lift the timeout
    if (targetMember) {
        await targetMember.timeout(null, `Reinstated by ${interaction.user.tag}`).catch(() => {});
    }

    // Re-post the message as an embed attributed to the original author
    if (channel?.isTextBased?.()) {
        const user = targetMember?.user ?? await interaction.client.users.fetch(held.user_id).catch(() => null);
        const displayName = targetMember?.displayName ?? user?.username ?? held.user_id;

        const embed = new EmbedBuilder()
            .setColor(0x55ff55)
            .setAuthor({ name: displayName, iconURL: user?.displayAvatarURL?.() })
            .setDescription(held.content || null)
            .setFooter({ text: `Reinstated by ${interaction.user.username}` })
            .setTimestamp();

        // Re-upload attachments where possible; fall back to embedding the URL
        const files = [];
        for (const a of held.attachments.slice(0, 5)) {
            try {
                const res = await fetch(a.url);
                if (res.ok) {
                    const buf = Buffer.from(await res.arrayBuffer());
                    files.push(new AttachmentBuilder(buf, { name: a.name || 'file' }));
                }
            } catch {
                // ignore; handled by the fallback below
            }
        }
        if (!files.length && held.attachments[0]) embed.setImage(held.attachments[0].url);

        await channel.send({
            content: `♻️ Reinstated message from <@${held.user_id}>:`,
            embeds: [embed],
            files,
            allowedMentions: { users: [] },
        }).catch(() => {});
    }

    storage.deleteHeldMessage(heldId);
    await resolveAlert(interaction, `✅ Reinstated by ${interaction.user.username}`, ButtonStyle.Success);
}

// The Purge button opens a modal to collect a reason. The purge + ban itself
// runs in modals/scamPurgeModal.js once the admin submits.
async function purge(interaction, userId) {
    const modal = new ModalBuilder()
        .setCustomId(`scam_purge_modal:${userId}:${interaction.message.id}`)
        .setTitle('Purge and ban user');

    const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason for the ban')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(300)
        .setPlaceholder('e.g. Mr Beast scam image and lfg ping');

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);
}

async function dismiss(interaction, heldId) {
    if (heldId) storage.deleteHeldMessage(heldId);
    await interaction.deferUpdate();
    await resolveAlert(interaction, `👌 Dismissed by ${interaction.user.username}`, ButtonStyle.Secondary);
}

async function resolveAlert(interaction, label, style) {
    const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('scam_resolved')
            .setLabel(label)
            .setStyle(style)
            .setDisabled(true)
    );
    await interaction.editReply({ components: [disabledRow] }).catch(() => {});
}
