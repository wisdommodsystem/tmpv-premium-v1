const { EmbedBuilder, Routes } = require('discord.js');
const { getWhitelist, isPremiumMember } = require('../../utils/premiumStorage');

module.exports = {
  name: 'whitelistlist',
  aliases: ['whitelistlista', 'wlist'],
  description: 'View your personal premium whitelist.',
  execute: async (client, message, args, tempChannels) => {
    // 1. Check Premium Status
    const isPremium = await isPremiumMember(message.author.id);
    if (!isPremium) {
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
                  content: `## 🚫 **Access Denied**\n\n> This elite feature is reserved for **Premium subscribers 👑**.\n> \n> Please upgrade your package to manage your **Permanent Whitelist**.`
                }
              ]
            }
          ]
        };
        await client.rest.post(Routes.channelMessages(message.channelId), { body: errorPayload }).catch(() => {});
        return;
    }

    // 2. Fetch Whitelist
    const myWhitelist = await getWhitelist(message.author.id);

    if (!myWhitelist || myWhitelist.length === 0) {
        const emptyPayload = {
          flags: 32768, // IS_COMPONENTS_V2
          message_reference: { message_id: message.id },
          components: [
            {
              type: 17, // CONTAINER
              accent_color: 16766720, // Gold
              components: [
                {
                  type: 10,
                  content: `## <a:12104crownpink:1449139449211387945> **Premium Whitelist**\n\n> Your whitelist is currently **empty**.\n> Use \`.v whitelist @user\` to grant someone permanent access to your rooms.`
                }
              ]
            }
          ]
        };
        await client.rest.post(Routes.channelMessages(message.channelId), { body: emptyPayload }).catch(() => {});
        return;
    }

    // 3. Prepare List
    const listString = myWhitelist.map((id, index) => `${index + 1}. <@${id}> (ID: \`${id}\`)`).join('\n');

    const listPayload = {
      flags: 32768, // IS_COMPONENTS_V2
      message_reference: { message_id: message.id },
      components: [
        {
          type: 17, // CONTAINER
          accent_color: 16766720, // Gold
          components: [
            {
              type: 10,
              content: `## <a:12104crownpink:1449139449211387945> **Your Premium Whitelist**\n\n**Authorized Members:**\n${listString}\n\n**Managed By:** <@${message.author.id}>\n\n<a:boost:1449497847094444083> *These users can bypass your room locks and access your private chats automatically.*`
            }
          ]
        }
      ]
    };

    await client.rest.post(Routes.channelMessages(message.channelId), { body: listPayload }).catch(() => {});
  }
};
