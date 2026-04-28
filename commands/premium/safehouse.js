const { Routes } = require('discord.js');
const { isPremiumMember } = require('../../utils/premiumStorage');

module.exports = {
  name: 'safehouse',
  aliases: ['sh'],
  description: 'Toggle SafeHouse protection for your premium room.',
  execute: async (client, message, args, tempChannels) => {
    const voiceChannel = message.member.voice.channel;
    const channelData = tempChannels.get(voiceChannel?.id);

    const sendV2 = async (accent, content) => {
      const payload = {
        flags: 32768,
        message_reference: { message_id: message.id },
        components: [
          {
            type: 17,
            accent_color: accent,
            components: [{ type: 10, content }]
          }
        ]
      };
      await client.rest.post(Routes.channelMessages(message.channelId), { body: payload }).catch(() => {});
    };

    if (!voiceChannel || !channelData) {
      await sendV2(15548997, '## 🚫 **Command Error**\n\n> You must be inside your temporary voice room to use this command.');
      return;
    }

    if (channelData.ownerId !== message.author.id) {
      await sendV2(15548997, '## 🚫 **Access Denied**\n\n> Only the room owner can toggle **SafeHouse**.');
      return;
    }

    const premium = await isPremiumMember(message.author.id);
    if (!premium) {
      await sendV2(15548997, '## 🚫 **Premium Required**\n\n> SafeHouse is available only for **WS TMPV Premium** members.');
      return;
    }

    channelData.safeHouseEnabled = !channelData.safeHouseEnabled;

    if (channelData.safeHouseEnabled) {
      channelData.settings = channelData.settings || {};
      channelData.settings.safeHouse = true;
      await sendV2(
        16766720,
        '## 🏠 **SafeHouse Enabled**\n\n> Your room is now protected by **TMPV Anti-Abuse**.\n> Any user with Admin-level access who tries to join will be removed instantly and warned in DM.'
      );
    } else {
      if (channelData.settings) channelData.settings.safeHouse = false;
      await sendV2(
        9807270,
        '## 🏠 **SafeHouse Disabled**\n\n> TMPV Anti-Abuse protection is now turned off for this room.'
      );
    }
  }
};
