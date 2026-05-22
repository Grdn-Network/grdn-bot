// utils/nickname.js

/**
 * Builds a formatted Discord nickname based on crew type and train number.
 *
 * With a train number:
 *   TrainMaster → "!TOC | <train> | <name>"
 *   Dispatcher  → "!D | <train> | <name>"
 *   Yard Crew   → "#S | <train> | <name>"
 *   Road Crew   → "<train> | <name>"
 *
 * Without a train number (profile created outside an active session):
 *   TrainMaster → "!TOC | <name>"
 *   Dispatcher  → "!D | <name>"
 *   Yard Crew   → "#S | <name>"
 *   Road Crew   → "<name>"
 */
function buildNickname(type, trainNumber, preferredName) {
    const train = trainNumber && String(trainNumber).trim() ? String(trainNumber).trim() : null;

    if (type === 'TrainMaster') return train ? `!TOC | ${train} | ${preferredName}` : `!TOC | ${preferredName}`;
    if (type === 'Dispatcher')  return train ? `!D | ${train} | ${preferredName}`   : `!D | ${preferredName}`;
    if (type === 'Yard Crew')   return train ? `#S | ${train} | ${preferredName}`   : `#S | ${preferredName}`;
    if (train)                  return `${train} | ${preferredName}`;

    return preferredName;
}

module.exports = { buildNickname };
