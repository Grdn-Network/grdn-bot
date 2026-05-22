// commands/crew/defect.js
// /defect — toggle hotbox / defect alert announcements for yourself.
//
// Default: OFF. When ON, the bot will join your voice channel and play an
// audio alert whenever GRDNConnect detects a defect on your train.
//
// Any registered crew member can use this. No staff role needed.

const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('defect')
        .setDescription('Toggle hotbox / defect alerts for your train (default: off).'),

    async execute(interaction) {
        const userId = interaction.user.id;

        // Upsert: get current state, flip it
        const existing = db.prepare(`SELECT enabled FROM defect_prefs WHERE user_id = ?`).get(userId);
        const nowEnabled = existing ? (existing.enabled ? 0 : 1) : 1; // first run → enable

        db.prepare(`
            INSERT INTO defect_prefs (user_id, enabled)
            VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled
        `).run(userId, nowEnabled);

        const status  = nowEnabled ? '🔔 **On**' : '🔕 **Off**';
        const detail  = nowEnabled
            ? 'The bot will join your voice channel and announce hotbox / defect alerts for your train.'
            : 'You will no longer receive voice defect alerts.';

        return interaction.reply({
            content: `Defect alerts: ${status}\n${detail}`,
            flags: 64,
        });
    },
};
