// config.js
module.exports = {
    // Channel IDs
    SETUP_CHANNEL_ID: '1474625317359452415',
    TRAIN_BOARD_CHANNEL_ID: '1477811143019069543',
    DISPATCH_CHANNEL_ID: '1477811143019069543',
    YARD_CHANNEL_ID: '1474695726008369194',
    CRASH_LOG_CHANNEL_ID: '1503194667255074846', //dvmp-command
    ADMIN_CHANNEL_ID: '1474624720073920563',
    OPS_CHAT_CHANNEL_ID: '1498270262632910868', // #ops-chat; in-game commands must run here
    OPS_CATEGORY_ID: '1474550973878767660',     // ops category; /session allowed anywhere under it

    // Role IDs
    ADMIN_ROLE: '1474625834798022828',
    DISPATCH_QUAL_ROLE: '1474628588568580146',
    HOST_ROLE: '1482790161174761542',
    TRAINMASTER_ROLE: '1474629091650179132',
    DVMP_COMMAND_ROLE: '1503297126585860187', // dvmp-command — pseudo-admin

    // Roles allowed to perform staff actions
    STAFF_ROLES: [
        '1474625834798022828', // Admin
        '1474628588568580146', // Dispatch Qual
        '1482790161174761542', // Host
        '1503297126585860187', // DVMP Command
    ],

    // XFER allowed roles
    XFER_ROLES: [
        '1474625834798022828', // Admin
        '1474628588568580146', // Dispatch Qual
        '1474629091650179132', // TrainMaster
        '1503297126585860187', // DVMP Command
    ],

    NEWCOMER_ROLE: '1474628430149718141',

    // Crew Voice Channels — set this to the category ID where Crew VCs should be created
    CREW_VC_CATEGORY_ID: '1474550973878767660',

    // ── Security / anti-scam ────────────────────────────────────────────
    // Default on/off for the scanner at first run. /moderation stores a live
    // override in the DB, so you can toggle it without a restart.
    SCAM_MODERATION_ENABLED: true,

    // @lfg role, locked in Discord so only the bot can ping it; members use /lfg
    LFG_ROLE: '1513233471483412642',
    // Channel where /lfg is allowed (and where it posts)
    LFG_CHANNEL_ID: '1477113793099337779',
    // Minimum wait between a user's /lfg pings
    LFG_COOLDOWN_MS: 20 * 60 * 1000,

    // Channels where newcomers may post media without being flagged
    MEDIA_CHANNELS: [
        '1479265847716348097', // #media (DVMP)
        '1476901402038239262', // #off-topic (anything goes except NSFW)
    ],

    // Where scam alerts are posted, and which role gets pinged to review
    SCAM_ALERT_CHANNEL: '1474624720073920563', // #admin (== ADMIN_CHANNEL_ID)
    SCAM_ALERT_ROLE: '1474625834798022828',    // @Admin (== ADMIN_ROLE)

    // Staff are skipped by the scanner for now. Flip to false to include the
    // burst / mass-mention check for compromised staff accounts.
    STAFF_EXEMPT: true,

    // Timeout durations applied on medium / high confidence
    SCAM_TIMEOUT_SHORT_MS: 15 * 60 * 1000,      // medium
    SCAM_TIMEOUT_LONG_MS: 24 * 60 * 60 * 1000,  // high

    // Burst detection: the same message from one user appearing in this many
    // DISTINCT channels within the window escalates to high and deletes all copies.
    SCAM_BURST_WINDOW_MS: 60 * 1000,
    SCAM_BURST_THRESHOLD: 2,

    // Optional: auto-strip a "member" role whenever a user also has NEWCOMER
    // (deferred: old invite links wrongly grant member). Set the ID + true to enable.
    MEMBER_ROLE: null,
    MEMBER_AUTOSTRIP: false,

};