// logging/reactToUser.js
const TARGET_USER = "269243663471607808"; // Replace with the user's ID
const EMOJI = "🗣️"; // :interrobang:

module.exports = (client) => {
    client.on('messageCreate', async (message) => {
        // Ignore bot messages
        if (message.author.bot) return;

        // Only react to the target user
        if (message.author.id !== TARGET_USER) return;

        try {
            await message.react(EMOJI);
        } catch (err) {
            console.error("Failed to react to message:", err);
        }
    });
};