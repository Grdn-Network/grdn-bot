// commands/dispatch/removemod.js
// Removes a mod from the Required Mods list.
// The name field uses autocomplete so staff don't have to type exactly.
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/db');
const { buildDispatchEmbed } = require('../../utils/dispatchEmbed');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE, DISPATCH_CHANNEL_ID } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removemod')
        .setDescription('Remove a mod from the Required Mods section of the Operations embed.')
        .addStringOption(o =>
            o.setName('name')
                .setDescription('Mod to remove')
                .setRequired(true)
                .setAutocomplete(true)
        ),

    // Autocomplete: return mod names that contain what the user has typed so far
    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const mods = db.prepare(`SELECT name FROM mods ORDER BY sort_order, id`).all();
        const choices = mods
            .filter(m => m.name.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(m => ({ name: m.name, value: m.name }));
        await interaction.respond(choices);
    },

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE])) {
            return interaction.reply({ content: '❌ Only admins and hosts can manage mods.', flags: 64 });
        }

        const name = interaction.options.getString('name').trim();
        const existing = db.prepare(`SELECT id FROM mods WHERE name = ? COLLATE NOCASE`).get(name);

        if (!existing) {
            return interaction.reply({
                content: `❌ No mod named **${name}** found. Check the spelling or use autocomplete.`,
                flags: 64
            });
        }

        db.prepare(`DELETE FROM mods WHERE id = ?`).run(existing.id);

        await rebuildEmbed(interaction);

        const remaining = db.prepare(`SELECT name, url, note FROM mods ORDER BY sort_order, id`).all();
        const list = remaining.length === 0
            ? '_None — add mods with `/addmod`._'
            : remaining.map((m, i) => {
                let line = `${i + 1}. **${m.name}**`;
                if (m.url)  line += ` — <${m.url}>`;
                if (m.note) line += ` *(${m.note})*`;
                return line;
              }).join('\n');

        return interaction.reply({
            content: `✅ Removed **${name}**.\n\n**Remaining mods:**\n${list}`,
            flags: 64
        });
    }
};

async function rebuildEmbed(interaction) {
    try {
        const embedRow = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
        if (!embedRow) return;
        const channel = interaction.guild.channels.cache.get(DISPATCH_CHANNEL_ID);
        if (!channel) return;
        const msg = await channel.messages.fetch(embedRow.message_id).catch(() => null);
        if (msg) await msg.edit({ embeds: [buildDispatchEmbed()], components: msg.components });
    } catch (err) {
        console.error('[removemod] Embed rebuild failed:', err);
    }
}
