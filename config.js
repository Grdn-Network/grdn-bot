// config.js
module.exports = {
    // Channel IDs
    TRAIN_BOARD_CHANNEL_ID: '1477811143019069543',
    DISPATCH_CHANNEL_ID: '1477811143019069543',
    YARD_CHANNEL_ID: '1474695726008369194',
    CRASH_LOG_CHANNEL_ID: '1503194667255074846', //dvmp-command
    ADMIN_CHANNEL_ID: '1474624720073920563',

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

    // DV Connection
    DV_HOST: '73.180.75.143',
    DV_PORT: '7230',
};