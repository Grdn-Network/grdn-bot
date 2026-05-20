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
    const hasTrain = trainNumber && String(trainNumber).trim();

    if (type === 'TrainMaster') return `!TOC | ${trainNumber} | ${preferredName}`;
    if (type === 'Dispatcher')  return `!D | ${trainNumber} | ${preferredName}`;
    if (type === 'Yard Crew')   return `#S | ${trainNumber} | ${preferredName}`;
    if (hasTrain)               return `${trainNumber} | ${preferredName}`;

    // No type and no train number — bare profile, just the preferred name
    return preferredName;
}

module.exports = { buildNickname };
