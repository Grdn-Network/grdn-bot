// logging/opsVoiceTracker.js
// Starts/stops hour tracking when crew join or leave voice channels during an active ops session.
const storage = require('../storage');

module.exports = (client) => {
    client.on('voiceStateUpdate', (oldState, newState) => {
        try {
            const user = newState.member?.user ?? oldState.member?.user;
            if (!user || user.bot) return;

            const userId = user.id;
            const guildId = (newState.guild ?? oldState.guild).id;
            const now = Date.now();

            const oldChannel = oldState.channel;
            const newChannel = newState.channel;

            // Left voice entirely — close their open ops entry if one exists
            if (oldChannel && !newChannel) {
                storage.closeOpsEntry(userId, guildId, now);
                return;
            }

            // Joined voice — open an ops entry if a session is active and they're crew
            if (!oldChannel && newChannel) {
                const session = storage.getActiveSession(guildId);
                if (!session) return;

                const crew = storage.getCrewByUserId(guildId, userId);
                if (!crew) return;

                const category = storage.classifyCategory(crew.type, crew.trainNumber);
                if (!category) return;

                storage.openOpsEntry(userId, guildId, session.id, category, now);
            }

            // Moved between channels — still in voice, no change to ops tracking
        } catch (err) {
            console.error('[opsVoiceTracker] Error:', err);
        }
    });
};
