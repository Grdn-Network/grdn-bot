// commands/dispatch/addmod.js
// Adds or updates a mod in the Required Mods list.
// If the name already exists the url/note are updated in place.
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/db');
const { buildDispatchEmbed } = require('../../utils/dispatchEmbed');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE, DISPATCH_CHANNEL_ID } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addmod')
        .setDescription('Add or update a mod in the Required Mods section of the Operations embed.')
        .addStringOption(o =>
            o.setName('name')
                .setDescription('Mod name as it will appear in the embed (e.g. Derail Valley Multiplayer)')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('url')
                .setDescription('Download / info link — must start with http:// or https://')
                .setRequired(false)
        )
        .addStringOption(o =>
            o.setName('note')
                .setDescription('Short note shown after the link (e.g. "Required for hosts only")')
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE])) {
            return interaction.reply({ content: '❌ Only admins and hosts can manage mods.', flags: 64 });
        }

        const name = interaction.options.getString('name').trim();
        const url  = interaction.options.getString('url')?.trim()  || null;
        const note = interaction.options.getString('note')?.trim() || null;

        if (url && !/^https?:\/\/.+/i.test(url)) {
            return interaction.reply({
                content: '❌ URL must start with `http://` or `https://`.',
                flags: 64
            });
        }

        const existing = db.prepare(`SELECT id FROM mods WHERE name = ? COLLATE NOCASE`).get(name);

        if (existing) {
            db.prepare(`UPDATE mods SET url = ?, note = ? WHERE id = ?`).run(url, note, existing.id);
        } else {
            const { m: maxOrder } = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM mods`).get();
            db.prepare(`INSERT INTO mods (name, url, note, sort_order) VALUES (?, ?, ?, ?)`).run(name, url, note, maxOrder + 1);
        }

        await rebuildEmbed(interaction);

        const allMods = db.prepare(`SELECT name, url, note FROM mods ORDER BY sort_order, id`).all();
        const list = allMods.map((m, i) => {
            let line = `${i + 1}. **${m.name}**`;
            if (m.url)  line += ` — <${m.url}>`;
            if (m.note) line += ` *(${m.note})*`;
            return line;
        }).join('\n');

        return interaction.reply({
            content: `✅ ${existing ? 'Updated' : 'Added'} **${name}**.\n\n**Current mod list:**\n${list}`,
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
        console.error('[addmod] Embed rebuild failed:', err);
    }
}
