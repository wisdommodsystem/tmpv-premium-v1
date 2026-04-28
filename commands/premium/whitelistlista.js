const { EmbedBuilder, Routes } = require('discord.js');
const { getWhitelist, getAllWhitelists, isPremiumMember, savePanelData } = require('../../utils/premiumStorage');

module.exports = {
  name: 'whitelistlista',
  aliases: ['whitelistlist', 'wlist'],
  description: 'Deploy the dynamic premium whitelist report panel.',
  execute: async (client, message, args, tempChannels) => {
    const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
    const isAdmin = message.member.roles.cache.has(ADMIN_ROLE_ID) || message.member.permissions.has('Administrator');

    if (!isAdmin) {
      const errorPayload = {
        flags: 32768, // IS_COMPONENTS_V2
        message_reference: { message_id: message.id },
        components: [
          {
            type: 17, // CONTAINER
            accent_color: 15548997, // Red
            components: [
              {
                type: 10,
                content: `## 🚫 **Access Denied**\n\n> This command is reserved for **Administrators** to deploy the global whitelist monitor.`
              }
            ]
          }
        ]
      };
      await client.rest.post(Routes.channelMessages(message.channelId), { body: errorPayload }).catch(() => { });
      return;
    }

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

    const reportPayload = {
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

    try {
      const sentMsg = await client.rest.post(Routes.channelMessages(message.channelId), { body: reportPayload });

      if (sentMsg) {
        await savePanelData(message.guildId, message.channelId, sentMsg.id, 'whitelist_monitor');
        // Delete the trigger message ONLY after successful post
        await message.delete().catch(() => { });
      }
    } catch (err) {
      console.error('FAILED to send whitelistlista panel:', err);
      // Error message for the user
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription(`❌ Failed to deploy panel: ${err.message}`)] }).catch(() => { });
    }
  }
};
