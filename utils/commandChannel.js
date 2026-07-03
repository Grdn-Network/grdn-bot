// utils/commandChannel.js
// Small guards that keep certain commands in their proper place. Each returns
// true if allowed; otherwise it sends an ephemeral nudge and returns false, so
// the caller can `if (!await requireChannel(...)) return;` at the top of execute.

async function requireChannel(interaction, channelId) {
    if (interaction.channelId === channelId) return true;
    await interaction.reply({
        content: `❌ Please use this command in <#${channelId}>.`,
        flags: 64,
    });
    return false;
}

async function requireCategory(interaction, categoryId) {
    if (interaction.channel?.parentId === categoryId) return true;
    await interaction.reply({
        content: `❌ Please use this command in a channel under <#${categoryId}>.`,
        flags: 64,
    });
    return false;
}

module.exports = { requireChannel, requireCategory };
