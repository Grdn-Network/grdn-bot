// commands/community/signals.js
// Posts the GRDN OPS signals reference chart. Public on purpose: the reply shows
// in the channel so everyone can see it, not just the person who ran it.
//
// The image is bundled in the repo (assets/) rather than hosted on a URL, so
// there is nothing external to expire or go down. To update the chart, replace
// the file and commit. Any of signals.png / .gif / .jpg / .jpeg / .webp works.

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');
const IMAGE_RE   = /^signals\.(png|gif|jpe?g|webp)$/i;

// Resolve the signals image path once at load; re-check on miss so a freshly
// added file is picked up without a code change.
function findSignalsImage() {
    try {
        const file = fs.readdirSync(ASSETS_DIR).find(f => IMAGE_RE.test(f));
        return file ? path.join(ASSETS_DIR, file) : null;
    } catch {
        return null;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('signals')
        .setDescription('Show the GRDN OPS signals reference chart.'),

    async execute(interaction) {
        const imagePath = findSignalsImage();

        if (!imagePath) {
            return interaction.reply({
                content: '⚠️ The signals chart is not installed yet. A staff member needs to add the image to the bot.',
                flags: 64,
            });
        }

        const fileName   = `signals${path.extname(imagePath)}`;
        const attachment = new AttachmentBuilder(imagePath, { name: fileName });

        const embed = new EmbedBuilder()
            .setTitle('🚦 GRDN OPS Signals')
            .setColor(0xf0a000)
            .setImage(`attachment://${fileName}`);

        // Public reply: visible to everyone in the channel.
        return interaction.reply({ embeds: [embed], files: [attachment] });
    },
};
