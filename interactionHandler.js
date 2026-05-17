// interactionHandler.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ADMIN_ROLE } = require('./config');

module.exports = (client) => {

    client.on('interactionCreate', async interaction => {

        // -----------------------------
        // SLASH COMMAND HANDLER
        // -----------------------------
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.execute(interaction);
            } catch (err) {
                console.error(err);
                await interaction.reply({ content: '❌ Error executing command.', flags: 64 });
            }
            return;
        }

        // -----------------------------
        // BUTTON HANDLER
        // -----------------------------
        if (!interaction.isButton()) return;

        const member = interaction.guild.members.cache.get(interaction.user.id);

        // --- SYNC NAMES BUTTON ---
        if (interaction.customId === 'syncnames_btn') {
            if (!member.roles.cache.has(ADMIN_ROLE)) {
                return interaction.reply({ content: '❌ Only admins can sync names.', flags: 64 });
            }
            const syncCmd = client.commands.get('syncnames');
            if (!syncCmd) {
                return interaction.reply({ content: '❌ Syncnames command not found.', flags: 64 });
            }
            return syncCmd.execute(interaction);
        }

        // --- RESET NAMES BUTTON ---
        if (interaction.customId === 'resetnames_btn') {
            if (!member.roles.cache.has(ADMIN_ROLE)) {
                return interaction.reply({ content: '❌ Only admins can reset names.', flags: 64 });
            }
            const resetCmd = client.commands.get('resetnames');
            if (!resetCmd) {
                return interaction.reply({ content: '❌ resetnames command not found.', flags: 64 });
            }
            return resetCmd.execute(interaction);
        }

        // --- TRANSFER APPROVE BUTTON ---
        if (interaction.customId.startsWith('xfer_approve_')) {
            const parts = interaction.customId.split('_');
            const operatorId = parts[2];
            const receiverId = parts[3];
            const requesterId = parts[4];

            if (interaction.user.id !== receiverId) {
                return interaction.reply({
                    content: '❌ Only the assigned receiver can approve this transfer.',
                    flags: 64
                });
            }

            const updatedRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(interaction.customId)
                    .setLabel(`Approved by ${interaction.user.username}`)
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true)
            );

            await interaction.update({ components: [updatedRow] });

            return interaction.followUp({
                content: `<@${requesterId}> your request has been approved.`,
                allowedMentions: { users: [requesterId] }
            });
        }

    });
};