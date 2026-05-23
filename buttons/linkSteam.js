// buttons/linkSteam.js
// Handles the "Yes, that's me" button on the Steam auto-link embed.
//
// customId format: linksteam:<steamId64>:<trainNumber>:<locoType>
//   e.g.           linksteam:76561198000000000:034:DE6
//
// On click:
//   - Links the player's Steam ID64 → their Discord user ID (permanent, one-time)
//   - Updates their crew registration with the train + loco from the embed
//   - Edits the embed to ✅ Linked and disables the button

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder } = require('discord.js');
const storage        = require('../database/storage');
const { buildNickname }   = require('../utils/nickname');
const { updateTrainBoard } = require('../utils/trainBoard');
const { TRAIN_BOARD_CHANNEL_ID } = require('../config');

module.exports = {
    // Dynamic custom ID — matched by prefix, not exact string
    matches: (id) => id.startsWith('linksteam:'),

    async execute(interaction) {
        const parts      = interaction.customId.split(':');
        const steamId    = parts[1];
        const trainNumber = parts[2] || null;
        const locoType   = parts[3] || null;

        if (!steamId) {
            return interaction.reply({ content: '❌ Invalid link data in button.', flags: 64 });
        }

        const discordId = interaction.user.id;

        // ── Already linked to this user → idempotent success ─────────────────
        const existing = storage.getSteamLink(steamId);
        if (existing?.discordId === discordId) {
            return interaction.reply({
                content: '✅ This Steam account is already linked to your Discord.',
                flags: 64,
            });
        }

        // ── Claimed by a different user ───────────────────────────────────────
        if (existing && existing.discordId !== discordId) {
            return interaction.reply({
                content: '❌ This Steam account is already linked to a different Discord user. Ask an admin if this is wrong.',
                flags: 64,
            });
        }

        // ── Store the link ────────────────────────────────────────────────────
        storage.setSteamLink(steamId, discordId);
        console.log(`[SteamLink] Linked Steam ${steamId} → Discord ${discordId} (${interaction.user.username})`);

        // ── Update crew registration if they have one ─────────────────────────
        const crew = storage.getCrewRaw(discordId);
        if (crew && trainNumber) {
            const newLocoType = locoType || crew.loco_type || null;
            storage.upsertCrew(discordId, crew.type, trainNumber, crew.preferred_name, newLocoType);

            // Sync nickname
            const member = await interaction.guild.members.fetch(discordId).catch(() => null);
            if (member) {
                const nick = buildNickname(crew.type, trainNumber, crew.preferred_name);
                await member.setNickname(nick).catch(() => {});
            }

            // Refresh train board
            await updateTrainBoard(
                interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID
            ).catch(() => {});
        }

        // ── Update the embed: show it's claimed ──────────────────────────────
        const originalEmbed = interaction.message.embeds[0];
        const updatedEmbed  = EmbedBuilder.from(originalEmbed)
            .setTitle('✅ Account linked')
            .setColor(0x57F287)
            .setDescription(`Linked to <@${discordId}>.\nFuture sessions are now fully automatic — no Discord commands needed.`);

        const disabledRow = new ActionRowBuilder().addComponents(
            ButtonBuilder.from(interaction.message.components[0].components[0])
                .setDisabled(true)
                .setLabel('✅  Linked')
        );

        await interaction.update({ embeds: [updatedEmbed], components: [disabledRow] });
    },
};
