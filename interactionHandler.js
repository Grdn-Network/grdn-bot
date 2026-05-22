// interactionHandler.js
const fs = require('fs');
const path = require('path');

module.exports = (client) => {

    // Load button handlers from buttons/ directory
    const buttonHandlers = [];
    const buttonsPath = path.join(__dirname, 'buttons');
    if (fs.existsSync(buttonsPath)) {
        for (const file of fs.readdirSync(buttonsPath).filter(f => f.endsWith('.js'))) {
            const handler = require(`./buttons/${file}`);
            buttonHandlers.push(handler);
            console.log(`[BUTTONS] Loaded ${file}`);
        }
    }

    // Load modal handlers from modals/ directory
    const modalHandlers = [];
    const modalsPath = path.join(__dirname, 'modals');
    if (fs.existsSync(modalsPath)) {
        for (const file of fs.readdirSync(modalsPath).filter(f => f.endsWith('.js'))) {
            const handler = require(`./modals/${file}`);
            modalHandlers.push(handler);
            console.log(`[MODALS] Loaded ${file}`);
        }
    }

    // Safe reply helper — works whether interaction is fresh, deferred, or already replied.
    async function safeReply(interaction, payload) {
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(payload);
            } else {
                await interaction.reply(payload);
            }
        } catch {
            // Interaction expired or unreachable — nothing we can do
        }
    }

    client.on('interactionCreate', async interaction => {

        // Ignore DMs — all features are guild-only
        if (!interaction.guild) return;

        // -----------------------------
        // AUTOCOMPLETE HANDLER
        // -----------------------------
        if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);
            if (!command?.autocomplete) return;
            try {
                await command.autocomplete(interaction);
            } catch (err) {
                console.error('[Autocomplete Error]', interaction.commandName, err);
            }
            return;
        }

        // -----------------------------
        // SLASH COMMAND HANDLER
        // -----------------------------
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.execute(interaction);
            } catch (err) {
                console.error('[Command Error]', interaction.commandName, err);
                await safeReply(interaction, {
                    content: '❌ An error occurred while executing this command.',
                    flags: 64
                });
            }
            return;
        }

        // -----------------------------
        // MODAL SUBMIT HANDLER
        // -----------------------------
        if (interaction.isModalSubmit()) {
            const handler = modalHandlers.find(h =>
                h.customId
                    ? h.customId === interaction.customId
                    : h.matches?.(interaction.customId)
            );
            if (!handler) return;
            try {
                await handler.execute(interaction);
            } catch (err) {
                console.error('[Modal Error]', interaction.customId, err);
                await safeReply(interaction, { content: '❌ An error occurred.', flags: 64 });
            }
            return;
        }

        // -----------------------------
        // BUTTON HANDLER
        // -----------------------------
        if (!interaction.isButton()) return;

        const handler = buttonHandlers.find(h =>
            h.customId
                ? h.customId === interaction.customId
                : h.matches?.(interaction.customId)
        );

        if (!handler) return;

        try {
            await handler.execute(interaction);
        } catch (err) {
            console.error('[Button Error]', interaction.customId, err);
            await safeReply(interaction, { content: '❌ An error occurred.', flags: 64 });
        }
    });
};
