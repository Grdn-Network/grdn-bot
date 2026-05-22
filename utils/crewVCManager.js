// utils/crewVCManager.js
// Tracks crew voice channels and deletes them 5 minutes after they become empty.
// Also exports deleteAllCrewVCs for use by /ops end.
const storage = require('../database/storage');

const DELETE_DELAY_MS = 5 * 60 * 1000;
const deleteTimers = new Map(); // channelId → timeoutId

function scheduleDelete(client, channelId) {
    if (deleteTimers.has(channelId)) return;
    const timer = setTimeout(async () => {
        deleteTimers.delete(channelId);
        try {
            const ch = client.channels.cache.get(channelId);
            if (ch) await ch.delete('Crew VC empty for 5 minutes');
        } catch {}
        storage.removeCrewVC(channelId);
    }, DELETE_DELAY_MS);
    deleteTimers.set(channelId, timer);
}

function cancelDelete(channelId) {
    const timer = deleteTimers.get(channelId);
    if (timer !== undefined) {
        clearTimeout(timer);
        deleteTimers.delete(channelId);
    }
}

async function deleteAllCrewVCs(client, guildId) {
    const vcs = storage.getCrewVCs(guildId);
    for (const vc of vcs) {
        cancelDelete(vc.channel_id);
        try {
            const ch = client.channels.cache.get(vc.channel_id);
            if (ch) await ch.delete('Ops session ended');
        } catch {}
    }
    storage.clearAllCrewVCs(guildId);
}

const handler = (client) => {
    // On startup, schedule deletion for any tracked crew VCs that are already empty
    client.once('ready', () => {
        try {
            const guilds = client.guilds.cache.values();
            for (const guild of guilds) {
                const vcs = storage.getCrewVCs(guild.id);
                for (const vc of vcs) {
                    const ch = guild.channels.cache.get(vc.channel_id);
                    if (!ch) {
                        // Channel no longer exists — clean up DB
                        storage.removeCrewVC(vc.channel_id);
                    } else if (ch.members.size === 0) {
                        scheduleDelete(client, vc.channel_id);
                    }
                }
            }
        } catch (err) {
            console.error('[crewVCManager] Startup check error:', err);
        }
    });

    client.on('voiceStateUpdate', (oldState, newState) => {
        try {
            // Someone left a crew VC — schedule deletion if now empty
            if (oldState.channel) {
                const vc = storage.getCrewVCByChannel(oldState.channel.id);
                if (vc && oldState.channel.members.size === 0) {
                    scheduleDelete(client, oldState.channel.id);
                }
            }
            // Someone joined a crew VC — cancel any pending deletion
            if (newState.channel) {
                const vc = storage.getCrewVCByChannel(newState.channel.id);
                if (vc) cancelDelete(newState.channel.id);
            }
        } catch (err) {
            console.error('[crewVCManager] Error:', err);
        }
    });
};

handler.deleteAllCrewVCs = deleteAllCrewVCs;
module.exports = handler;
