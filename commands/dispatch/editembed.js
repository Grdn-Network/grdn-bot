// commands/dispatch/editembed.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/db');
const { buildDispatchEmbed, deriveDvConnectUrl } = require('../../utils/dispatchEmbed');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE, DVMP_COMMAND_ROLE, DISPATCH_CHANNEL_ID } = require('../../config');

// Fields only admins may edit. Setup is admin-owned config; the rest
// (server name/password, RD link/password) is operational and hosts need it
// every session.
const ADMIN_ONLY_FIELDS = ['setup_notes'];

// Whitelist — maps choice value → DB column name and display label.
// Column names are hardcoded here, never interpolated from user input.
// mods_list removed — Required Mods are now managed via /addmod and /removemod
const FIELD_MAP = {
    setup_notes:     { column: 'setup_notes',     label: 'Setup'                    },
    rd_setup:        { column: 'rd_setup',         label: 'Remote Dispatch Setup'    },
    server_name:     { column: 'server_name',      label: 'Server Name'              },
    server_password: { column: 'server_password',  label: 'Server Password'          },
    remote_link:     { column: 'remote_link',      label: 'Remote Dispatch Link'     },
    remote_password: { column: 'remote_password',  label: 'Remote Dispatch Password' },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('editembed')
        .setDescription('Edit any field in the Operations embed.')
        .addStringOption(option =>
            option.setName('field')
                .setDescription('Which section to update')
                .setRequired(true)
                .addChoices(
                    { name: 'Setup',                    value: 'setup_notes'     },
                    { name: 'Remote Dispatch Setup',    value: 'rd_setup'        },
                    { name: 'Server Name',              value: 'server_name'     },
                    { name: 'Server Password',          value: 'server_password' },
                    { name: 'Remote Dispatch Link',     value: 'remote_link'     },
                    { name: 'Remote Dispatch Password', value: 'remote_password' }
                )
        )
        .addStringOption(option =>
            option.setName('value')
                .setDescription('New content for that field')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE, DVMP_COMMAND_ROLE])) {
            return interaction.reply({ content: '❌ Only admins and hosts can edit the embed.', flags: 64 });
        }

        const fieldKey = interaction.options.getString('field');
        const value    = interaction.options.getString('value');

        const fieldDef = FIELD_MAP[fieldKey];
        if (!fieldDef) return interaction.reply({ content: '❌ Invalid field.', flags: 64 });

        if (ADMIN_ONLY_FIELDS.includes(fieldKey) && !hasAnyRole(interaction.member, [ADMIN_ROLE])) {
            return interaction.reply({
                content: `❌ Only admins can edit **${fieldDef.label}**. The other embed fields are open to hosts.`,
                flags: 64
            });
        }

        // Ensure settings row exists before writing
        db.prepare(`
            INSERT OR IGNORE INTO dispatch_settings (id, server_name, server_password, remote_link, remote_password)
            VALUES (1, 'Not set', 'Not set', 'Not set', 'GRDN')
        `).run();

        // Write new value — column name comes from our own whitelist, never from user input
        db.prepare(`UPDATE dispatch_settings SET ${fieldDef.column} = ? WHERE id = 1`).run(value);

        // Auto-derive DV connection URL when the Remote Dispatch link is updated
        let dvNote = '';
        if (fieldKey === 'remote_link') {
            const storage = require('../../database/storage');
            const autoDvUrl = deriveDvConnectUrl(value);
            if (autoDvUrl) {
                storage.setDvUrl(autoDvUrl);
                dvNote = `\n🔗 DV connection auto-set to \`${autoDvUrl}\``;
            }
        }

        // Rebuild the live embed from DB state
        const embedRow = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
        if (!embedRow) {
            return interaction.reply({
                content: `✅ Saved **${fieldDef.label}** — no embed posted yet. Run \`/operembed\` to post it.${dvNote}`,
                flags: 64
            });
        }

        const channel = interaction.guild.channels.cache.get(DISPATCH_CHANNEL_ID);
        if (!channel) {
            return interaction.reply({
                content: `✅ Saved in DB — dispatch channel not found in cache.${dvNote}`,
                flags: 64
            });
        }

        const msg = await channel.messages.fetch(embedRow.message_id).catch(() => null);
        if (!msg) {
            return interaction.reply({
                content: `✅ Saved in DB — embed message not found. Run \`/operembed\` to repost.${dvNote}`,
                flags: 64
            });
        }

        // Edit the message — preserve existing buttons by passing msg.components
        await msg.edit({ embeds: [buildDispatchEmbed()], components: msg.components });

        return interaction.reply({
            content: `✅ Updated **${fieldDef.label}**.${dvNote}`,
            flags: 64
        });
    }
};
