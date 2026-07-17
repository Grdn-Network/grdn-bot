// interactionHandler.js
const fs = require('fs');
const path = require('path');
const activityLog = require('./utils/activityLog');

module.exports = (client) => {

    // Base identity fields for an activity row.
    function actor(interaction) {
        return {
            guildId:   interaction.guild?.id ?? null,
            userId:    interaction.user.id,
            userTag:   interaction.user.tag,
            channelId: interaction.channelId ?? null,
        };
    }

    // Runs a handler and records the attempt either way. Recording never throws,
    // so it cannot interfere with the interaction itself.
    async function runLogged(interaction, { kind, name, detail }, fn, onError) {
        try {
            await fn();
            activityLog.record({ ...actor(interaction), kind, name, detail, status: 'ok' });
        } catch (err) {
            activityLog.record({
                ...actor(interaction), kind, name, detail,
                status: 'error',
                error: err?.message ?? String(err),
            });
            await onError(err);
        }
    }

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

    // Find a handler by customId, optionally requiring supportsDM
    function findHandler(handlers, customId, requireDM = false) {
        return handlers.find(h => {
            const idMatch = h.customId ? h.customId === customId : h.matches?.(customId);
            return idMatch && (!requireDM || h.supportsDM);
        });
    }

    client.on('interactionCreate', async interaction => {

        // ── DM interactions ───────────────────────────────────────────────────
        // Most features are guild-only, but handlers can opt in to DM support
        // by setting supportsDM: true.
        if (!interaction.guild) {
            if (interaction.isButton()) {
                const handler = findHandler(buttonHandlers, interaction.customId, true);
                if (!handler) return;
                await runLogged(
                    interaction,
                    { kind: 'button', name: interaction.customId },
                    () => handler.execute(interaction),
                    async (err) => {
                        console.error('[Button DM Error]', interaction.customId, err);
                        await safeReply(interaction, { content: '❌ An error occurred.', flags: 64 });
                    },
                );
            } else if (interaction.isModalSubmit()) {
                const handler = findHandler(modalHandlers, interaction.customId, true);
                if (!handler) return;
                await runLogged(
                    interaction,
                    {
                        kind: 'modal',
                        name: interaction.customId,
                        detail: activityLog.describeModalFields(interaction),
                    },
                    () => handler.execute(interaction),
                    async (err) => {
                        console.error('[Modal DM Error]', interaction.customId, err);
                        await safeReply(interaction, { content: '❌ An error occurred.', flags: 64 });
                    },
                );
            }
            return;
        }

        // ── Guild interactions ────────────────────────────────────────────────

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

            await runLogged(
                interaction,
                {
                    kind: 'command',
                    name: interaction.commandName,
                    detail: activityLog.describeOptions(interaction),
                },
                () => command.execute(interaction),
                async (err) => {
                    console.error('[Command Error]', interaction.commandName, err);
                    await safeReply(interaction, {
                        content: '❌ An error occurred while executing this command.',
                        flags: 64
                    });
                },
            );
            return;
        }

        // -----------------------------
        // MODAL SUBMIT HANDLER
        // -----------------------------
        if (interaction.isModalSubmit()) {
            const handler = findHandler(modalHandlers, interaction.customId);
            if (!handler) return;
            await runLogged(
                interaction,
                {
                    kind: 'modal',
                    name: interaction.customId,
                    detail: activityLog.describeModalFields(interaction),
                },
                () => handler.execute(interaction),
                async (err) => {
                    console.error('[Modal Error]', interaction.customId, err);
                    await safeReply(interaction, { content: '❌ An error occurred.', flags: 64 });
                },
            );
            return;
        }

        // -----------------------------
        // BUTTON HANDLER
        // -----------------------------
        if (!interaction.isButton()) return;

        const handler = findHandler(buttonHandlers, interaction.customId);
        if (!handler) return;

        await runLogged(
            interaction,
            { kind: 'button', name: interaction.customId },
            () => handler.execute(interaction),
            async (err) => {
                console.error('[Button Error]', interaction.customId, err);
                await safeReply(interaction, { content: '❌ An error occurred.', flags: 64 });
            },
        );
    });
};
