// commands/operembed.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/db');
const { ADMIN_ROLE, HOST_ROLE, DISPATCH_CHANNEL_ID } = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('operembed')
        .setDescription('Post or restore the Operation Information embed if it is missing.'),

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(ADMIN_ROLE) && !interaction.member.roles.cache.has(HOST_ROLE)) {
            return interaction.reply({ content: '❌ Only admins and hosts can post the embed.', flags: 64 });
        }

        const channel = interaction.guild.channels.cache.get(DISPATCH_CHANNEL_ID);
        if (!channel) {
            return interaction.reply({ content: '❌ Dispatch channel not found.', flags: 64 });
        }

        // Check if embed already exists
        const existing = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
        if (existing?.message_id) {
            const existingMsg = await channel.messages.fetch(existing.message_id).catch(() => null);
            if (existingMsg) {
                return interaction.reply({ 
                    content: '❌ An Operation Information embed already exists. Use /editembed to update it.', 
                    flags: 64 
                });
            }
        }

        // Load current settings
        const settings = db.prepare(`
            SELECT server_name, server_password, remote_link, remote_password
            FROM dispatch_settings WHERE id = 1
        `).get() || {
            server_name: 'Not set',
            server_password: 'Not set',
            remote_link: 'Not set',
            remote_password: 'Not set',
        };

        const embed = new EmbedBuilder()
            .setTitle('🚂 Operation Information')
            .setColor(0x2b2d31)
            .addFields(
                { name: 'Server Name', value: settings.server_name || 'Not set', inline: false },
                { name: 'Server Password', value: settings.server_password || 'Not set', inline: false },
                { name: 'Remote Dispatch Link', value: settings.remote_link || 'Not set', inline: false },
                { name: 'Remote Dispatch Password', value: settings.remote_password || 'Not set', inline: false },
                { name: 'Remote Dispatch Setup', value: 'On the Remote Dispatch website, you will be asked to choose a username along with the password above. Please choose a username you will remember.', inline: false },
                { name: 'Required Mods', value: 'Please make sure all required mods are installed. <#1474676797768466504>', inline: false },
                { name: 'Setup a profile', value: 'Use the command /setcrew to update your crew info. Only your preferred name will remain after each operation.', inline: false }
            )
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('syncnames_btn')
                .setLabel('Sync Nicknames')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('resetnames_btn')
                .setLabel('Reset Names')
                .setStyle(ButtonStyle.Danger)
        );

        const msg = await channel.send({ embeds: [embed], components: [row] });

        db.prepare(`DELETE FROM dispatch_embed`).run();
        db.prepare(`INSERT INTO dispatch_embed (id, message_id) VALUES (1, ?)`).run(msg.id);

        return interaction.reply({ 
            content: '✅ Operation Information embed posted successfully.', 
            flags: 64 
        });
    }
};