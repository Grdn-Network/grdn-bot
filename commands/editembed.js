// commands/editembed.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database/db');
const { ADMIN_ROLE, HOST_ROLE, DISPATCH_CHANNEL_ID } = require('../config');

/**
 * Derives the GRDNConnect URL from a Remote Dispatch link.
 * e.g. https://rd.grdn.grdnnetwork.com → https://connect.grdn.grdnnetwork.com
 * Returns null if the link isn't a grdnnetwork.com subdomain.
 */
function deriveDvConnectUrl(rdLink) {
    try {
        const raw = rdLink.trim();
        const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        if (!url.hostname.endsWith('.grdnnetwork.com')) return null;
        // RD links are {name}.grdnnetwork.com — e.g. grdn.grdnnetwork.com
        // GRDNConnect lives at {name}-connect.grdnnetwork.com (single subdomain, covered by free Cloudflare cert)
        const hostName = url.hostname.split('.')[0]; // e.g. 'grdn', 'red', 'star'
        if (!hostName || hostName.endsWith('-connect')) return null;
        return `https://${hostName}-connect.grdnnetwork.com`;
    } catch {
        return null;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('editembed')
        .setDescription('Edit a field in the dispatch embed.')
        .addStringOption(option =>
            option.setName('field')
                .setDescription('Field to edit')
                .setRequired(true)
                .addChoices(
                    { name: 'Server Name', value: 'server_name' },
                    { name: 'Server Password', value: 'server_password' },
                    { name: 'Remote Dispatch Link', value: 'remote_link' },
                    { name: 'Remote Dispatch Password', value: 'remote_password' }
                )
        )
        .addStringOption(option =>
            option.setName('value')
                .setDescription('New value')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(ADMIN_ROLE) && !interaction.member.roles.cache.has(HOST_ROLE)) {
            return interaction.reply({ content: '❌ Only admins and hosts can edit the embed.', flags: 64 });
        }

        const field = interaction.options.getString('field');
        const value = interaction.options.getString('value');

        // Allowed fields whitelist — prevents SQL injection
        const allowedFields = ['server_name', 'server_password', 'remote_link', 'remote_password'];
        if (!allowedFields.includes(field)) {
            return interaction.reply({ content: '❌ Invalid field.', flags: 64 });
        }

        // Ensure settings row exists
        db.prepare(`
            INSERT OR IGNORE INTO dispatch_settings (id, server_name, server_password, remote_link, remote_password)
            VALUES (1, 'Not set', 'Not set', 'Not set', 'Not set')
        `).run();

        // Save new value to DB
        db.prepare(`UPDATE dispatch_settings SET ${field} = ? WHERE id = 1`).run(value);

        // Auto-set DV connection when Remote Dispatch link is updated
        let autoDvUrl = null;
        if (field === 'remote_link') {
            autoDvUrl = deriveDvConnectUrl(value);
            if (autoDvUrl) {
                const storage = require('../storage');
                storage.setDvUrl(autoDvUrl);
            }
        }

        // Fetch embed message ID
        const row = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
        if (!row) {
            return interaction.reply({ 
                content: '❌ No dispatch embed found. Use /postembed to create one.', 
                flags: 64 
            });
        }

        const channel = interaction.guild.channels.cache.get(DISPATCH_CHANNEL_ID);
        if (!channel) {
            return interaction.reply({ content: '❌ Dispatch channel not found.', flags: 64 });
        }

        const msg = await channel.messages.fetch(row.message_id).catch(() => null);
        if (!msg) {
            return interaction.reply({ 
                content: '❌ Dispatch embed message not found. Use /postembed to recreate it.', 
                flags: 64 
            });
        }

        const embed = EmbedBuilder.from(msg.embeds[0]);

        const fieldMap = {
            server_name: 'Server Name',
            server_password: 'Server Password',
            remote_link: 'Remote Dispatch Link',
            remote_password: 'Remote Dispatch Password'
        };

        const updatedFields = embed.data.fields.map(f =>
            f.name === fieldMap[field] ? { ...f, value } : f
        );

        embed.setFields(updatedFields);
        embed.setTimestamp();

        await msg.edit({ embeds: [embed] });

        const dvNote = autoDvUrl
            ? `\n🔗 DV connection auto-set to \`${autoDvUrl}\``
            : '';

        return interaction.reply({
            content: `✅ Updated **${fieldMap[field]}** to:\n\`${value}\`${dvNote}`,
            flags: 64
        });
    }
};