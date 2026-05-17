// config.js
module.exports = {
    // Channel IDs
    TRAIN_BOARD_CHANNEL_ID: '1477811143019069543',
    DISPATCH_CHANNEL_ID: '1477811143019069543',
    YARD_CHANNEL_ID: '1474695726008369194',
    CRASH_LOG_CHANNEL_ID: '1503194667255074846', //dvmp-command

    // Role IDs
    ADMIN_ROLE: '1474625834798022828',
    DISPATCH_QUAL_ROLE: '1474628588568580146',
    HOST_ROLE: '1482790161174761542',
    YM_QUAL_ROLE: '1474629091650179132',

    // Roles allowed to perform staff actions
    STAFF_ROLES: [
        '1474625834798022828', // Admin
        '1474628588568580146', // Dispatch Qual
        '1482790161174761542', // Host
    ],

    // XFER allowed roles
    XFER_ROLES: [
        '1474625834798022828', // Admin
        '1474628588568580146', // Dispatch Qual
        '1474629091650179132', // YM Qual
    ],

    // DV Connection
    DV_HOST: '73.180.75.143',
    DV_PORT: '7230',
};