// commands/complete.js
const { SlashCommandBuilder } = require('discord.js');
const fetch = require('node-fetch');
const db = require('../database/db');
const { STAFF_ROLES } = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('complete')
        .setDescription('Complete a Derail Valley job by job ID.')
        .addStringOption(opt =>
            opt.setName('jobid')
                .setDescription('The job ID to complete (e.g. HB-SU-27)')
                .setRequired(true)
        ),

    async execute(interaction) {
        const hasPermission = STAFF_ROLES.some(r => interaction.member.roles.cache.has(r));
        if (!hasPermission) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        const settings = db.prepare(`SELECT dv_host, dv_port FROM dv_settings WHERE id = 1`).get();
        if (!settings || !settings.dv_host || !settings.dv_port) {
            return interaction.reply({
                content: '❌ DV host/port not configured. Ask a staff member to run `/setdvconnection`.',
                flags: 64
            });
        }

        const jobId = interaction.options.getString('jobid');
        await interaction.reply({ content: `🔄 Attempting to complete job **${jobId}**...`, flags: 64 });

        try {
            const response = await fetch(`http://${settings.dv_host}:${settings.dv_port}/complete-job`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobId })
            });

            let result;
            try { result = await response.json(); } catch { result = null; }

            if (!result) {
                return interaction.followUp('⚠️ The Derail Valley mod returned an unexpected response. Is the game running?');
            }

            if (result.ok) {
                await interaction.followUp(`✅ Job **${jobId}** has been completed. The crew will receive payment in-game.`);
            } else if (response.status === 404) {
                await interaction.followUp(`⚠️ Job **${jobId}** could not be completed — it may not be finished yet or wasn't found.`);
            } else {
                await interaction.followUp(`❌ Could not complete job **${jobId}**: ${result.error ?? 'Unknown error'}`);
            }
        } catch (err) {
            console.error('[GRDNConnect] Error contacting DV mod:', err);
            await interaction.followUp('⚠️ Could not reach the Derail Valley mod. Is the game running and the mod enabled?');
        }
    }
};