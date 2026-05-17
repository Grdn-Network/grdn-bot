const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const { sendLog } = require('./logHelper');

const joinTimes = [];

module.exports = (client) => {
    client.on('guildMemberAdd', member => {
        const now = Date.now();
        joinTimes.push(now);

        // Keep only joins from the last 10 minutes
        while (joinTimes.length > 0 && now - joinTimes[0] > 600000) {
            joinTimes.shift();
        }

        if (joinTimes.length >= 5) {
            const embed = new EmbedBuilder()
                .setTitle('🚨 Possible Raid Detected')
                .setColor(0xff0000)
                .setDescription(`High join rate: **${joinTimes.length} joins** in the last 10 minutes.`)
                .setTimestamp();

            sendLog(client, config.logChannel, embed);
        }
    });
};
