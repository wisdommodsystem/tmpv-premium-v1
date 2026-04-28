const { Routes } = require('discord.js');
const { getAllWhitelists, getPanelData } = require('./premiumStorage');

async function updateWhitelistPanel(client, guildId) {
  const panelData = await getPanelData(guildId, 'whitelist_monitor');
  if (!panelData) return;

  try {
    const allWhitelists = await getAllWhitelists();
    let reportString = '';
    if (!allWhitelists || allWhitelists.length === 0) {
      reportString = "> *No active whitelists found in database.*";
    } else {
      allWhitelists.forEach(doc => {
        if (doc.whitelistedIds && doc.whitelistedIds.length > 0) {
          const friends = doc.whitelistedIds.map(id => `<@${id}>`).join(' ');
          reportString += `👤 **Owner:** <@${doc.ownerId}>\n📜 **Members:** ${friends}\n\n`;
        }
      });
    }

    if (!reportString) reportString = "> *No active whitelists found in database.*";

    const refreshedPayload = {
      flags: 32768, // IS_COMPONENTS_V2
      components: [
        {
          type: 12, // MEDIA_GALLERY
          items: [{ media: { url: "https://i.postimg.cc/Pf0Y7db0/download.gif" } }]
        },
        {
          type: 17, // CONTAINER
          accent_color: 16766720, // Gold
          components: [
            {
              type: 10,
              content: `## 🏆 **Supreme Whitelist Monitor**\n\n${reportString}\n<a:boost:1449497847094444083> **Status:** Live & Auto-Updating`
            },
            {
              type: 14 // SEPARATOR
            },
            {
              type: 10,
              content: `*This panel reflects all active Premium Whitelists and their authorized members. Changes are updated in real-time.*`
            }
          ]
        }
      ]
    };

    await client.rest.patch(Routes.channelMessage(panelData.channelId, panelData.messageId), { body: refreshedPayload });
  } catch (err) {
    console.error('Error updating whitelist panel:', err);
  }
}

module.exports = { updateWhitelistPanel };
