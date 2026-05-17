// utils/nickname.js

/**
 * Builds a formatted Discord nickname based on crew type.
 *
 * TrainMaster → "!TOC | <trainNumber> | <preferredName>"
 * Dispatcher  → "!D | <trainNumber> | <preferredName>"
 * Yard Crew   → "#S | <trainNumber> | <preferredName>"
 * Road Crew   → "<trainNumber> | <preferredName>"
 */
function buildNickname(type, trainNumber, preferredName) {
    if (type === 'TrainMaster') return `!TOC | ${trainNumber} | ${preferredName}`;
    if (type === 'Dispatcher')  return `!D | ${trainNumber} | ${preferredName}`;
    if (type === 'Yard Crew')   return `#S | ${trainNumber} | ${preferredName}`;
    return `${trainNumber} | ${preferredName}`;
}

module.exports = { buildNickname };
