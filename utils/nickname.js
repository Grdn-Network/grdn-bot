// utils/nickname.js
// Shared nickname formatting logic. Import this instead of duplicating prefix logic.

/**
 * Builds a formatted Discord nickname based on crew type.
 *
 * Dispatcher  → "!D | <trainNumber> | <preferredName>"
 * Shunter     → "#S | <trainNumber> | <preferredName>"
 * Road Crew   → "<trainNumber> | <preferredName>"
 *
 * @param {string} type - Crew type ('Dispatcher', 'Shunter', 'Road Crew')
 * @param {string} trainNumber
 * @param {string} preferredName
 * @returns {string}
 */
function buildNickname(type, trainNumber, preferredName) {
    let prefix = '';
    if (type === 'Dispatcher') prefix = '!D | ';
    else if (type === 'Shunter') prefix = '#S | ';
    return `${prefix}${trainNumber} | ${preferredName}`;
}

module.exports = { buildNickname };
