const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const commands = [];
function collectCommands(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectCommands(fullPath);
        } else if (entry.name.endsWith('.js')) {
            const command = require(fullPath);
            commands.push(command.data.toJSON());
        }
    }
}
collectCommands(path.join(__dirname, 'commands'));

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('Refreshing guild commands…');

        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );

        console.log('Guild commands updated instantly.');
    } catch (error) {
        console.error(error);
    }
})();
