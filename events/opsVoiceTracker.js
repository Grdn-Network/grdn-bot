// events/opsVoiceTracker.js
// Starts/stops hour tracking when crew join or leave voice channels during an active ops session.
const storage = require('../database/storage');

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

            // Joined voice — open an ops entry only if:
            // 1. An official session is active (/syncop was run)
            // 2. They explicitly opted in via /setcrew during this session (session_crew)
            // 3. They have a valid type + train number
            // Informal /setcrew users not in session_crew are never auto-enrolled.
            if (!oldChannel && newChannel) {
                const session = storage.getActiveSession(guildId);
                if (!session) return;

                if (!storage.isInSessionCrew(session.id, userId)) return;

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
