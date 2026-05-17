const fs = require('fs');
const path = require('path');

module.exports = (client) => {
    const logPath = path.join(__dirname);

    fs.readdirSync(logPath).forEach(file => {
        if (file === 'loader.js') return;
        if (!file.endsWith('.js')) return;

        const eventModule = require(`./${file}`);
        if (typeof eventModule === 'function') {
            eventModule(client);
            console.log(`[LOGGING] Loaded ${file}`);
        }
    });
};