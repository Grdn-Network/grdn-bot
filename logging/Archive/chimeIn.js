// logging/chimeIn.js

// How often the bot should chime in (1 = always, 0.1 = 10% of messages)
const CHANCE = 0.05; // 5% chance per message — tweak this

// Things the bot might say
const RESPONSES = [
    "Interesting point.",
    "I see what you're saying.",
    "That's actually kinda funny.",
    "Huh, didn't think about it that way.",
    "True.",
    "Fair enough.",
    "I get what you mean.",
    "That makes sense.",
    "Yeah, I can see that.",
    "Good take."
];

module.exports = (client) => {
    client.on('messageCreate', async (message) => {
        // Ignore bots
        if (message.author.bot) return;

        // Random chance to respond
        if (Math.random() > CHANCE) return;

        // Pick a random response
        const reply = RESPONSES[Math.floor(Math.random() * RESPONSES.length)];

        try {
            await message.reply(reply);
        } catch (err) {
            console.error("Failed to send chime-in message:", err);
        }
    });
};