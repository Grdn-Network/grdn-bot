// utils/statsHelper.js
// Hub-and-spoke classification and role-label logic for the Session Stats System.

/**
 * Classifies a job leg based on departure/destination yard IDs vs. the hub list.
 *
 * @param {string|null} departure    - Origin yard ID  (e.g. 'FF', 'MF')
 * @param {string|null} destination  - Dest  yard ID  (e.g. 'HB', 'GF')
 * @param {string[]}    hubs         - Array of hub yard IDs, upper-cased (e.g. ['MF','HB'])
 * @returns {'interchange'|'hub_inbound'|'hub_outbound'|'local'}
 */
function classifyLeg(departure, destination, hubs) {
    const dep = (departure    ?? '').toUpperCase();
    const des = (destination  ?? '').toUpperCase();
    const depIsHub = hubs.includes(dep);
    const desIsHub = hubs.includes(des);

    if (depIsHub && desIsHub) return 'interchange';   // hub ↔ hub
    if (desIsHub)             return 'hub_inbound';   // local → hub
    if (depIsHub)             return 'hub_outbound';  // hub  → local
    return 'local';                                   // local → local
}

/**
 * Returns a role label for a player based on their session or lifetime stats.
 * Falls back to 'Crew' if no activity is recorded yet.
 *
 * Stats shape (all fields optional, default 0):
 *   { car_miles, hub_outbound, local_deliveries, interchange, hub_inbound, jobs_completed }
 *
 * @param {object} stats
 * @returns {string}
 */
function getRoleLabel(stats) {
    const cm  = stats.car_miles        || 0;
    const ho  = stats.hub_outbound     || 0;
    const ld  = stats.local_deliveries || 0;
    const ic  = stats.interchange      || 0;

    const candidates = [
        { label: 'Heavy Hauler',    score: cm       },   // most car-miles
        { label: 'Getting it Done', score: ho + ld  },   // most deliveries out of hubs + local
        { label: 'Local Service',   score: ld       },   // most local-only deliveries
        { label: 'System Keystone', score: ic       },   // most hub↔hub moves
    ];

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].score > 0 ? candidates[0].label : 'Crew';
}

module.exports = { classifyLeg, getRoleLabel };
