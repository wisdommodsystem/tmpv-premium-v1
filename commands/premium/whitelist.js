const { EmbedBuilder, Routes } = require('discord.js');
const { isPremiumMember, addToWhitelist } = require('../../utils/premiumStorage');
const { updateWhitelistPanel } = require('../../utils/panelUpdater');

module.exports = {
  name: 'whitelist',
  description: 'Add a user to your personal whitelist (Offer 1+ Only).',
  execute: async (client, message, args, tempChannels) => {
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
                 content: `## 🚫 **Access Denied**\n\n> This exclusive feature is reserved for **Premium subscribers 👑**.\n> \n> Please upgrade your tier to unlock the **Permanent Whitelist System** and other elite benefits.`
               }
             ]
           }
         ]
       };
       await client.rest.post(Routes.channelMessages(message.channelId), { body: errorPayload }).catch(() => {});
       return;
    }

    const targetUser = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!targetUser) {
      const usageError = {
         flags: 32768, // IS_COMPONENTS_V2
         message_reference: { message_id: message.id },
         components: [
           {
             type: 17, // CONTAINER
             accent_color: 15548997, // Red
             components: [
               {
                 type: 10,
                 content: `## ❌ **Invalid Usage**\n\n> Please mention a user or provide a valid ID.\n> **Correct Usage:** \`.v whitelist @user\``
               }
             ]
           }
         ]
       };
       await client.rest.post(Routes.channelMessages(message.channelId), { body: usageError }).catch(() => {});
       return;
    }

    if (targetUser.id === message.author.id) {
       const selfError = {
         flags: 32768, // IS_COMPONENTS_V2
         message_reference: { message_id: message.id },
         components: [
           {
             type: 17, // CONTAINER
             accent_color: 15548997, // Red
             components: [
               {
                 type: 10,
                 content: `## 🚫 **Action Refused**\n\n> You are already the owner of this channel!`
               }
             ]
           }
         ]
       };
       await client.rest.post(Routes.channelMessages(message.channelId), { body: selfError }).catch(() => {});
       return;
    }

    await addToWhitelist(message.author.id, targetUser.id);

    // Update current VC permissions if owner is inside their temp channel
    const voiceChannel = message.member.voice.channel;
    if (voiceChannel) {
        const channelData = tempChannels.get(voiceChannel.id);
        if (channelData && channelData.ownerId === message.author.id) {
            await voiceChannel.permissionOverwrites.edit(targetUser.id, { 
                Connect: true,
                ViewChannel: true,
                Speak: true,
                UseVAD: true,
                SendMessages: true,
                ReadMessageHistory: true
            }).catch(() => {});
        }
    }

    const payload = {
      flags: 32768, // IS_COMPONENTS_V2
      message_reference: { message_id: message.id },
      components: [
        {
          type: 17, // CONTAINER
          accent_color: 16766720, // Gold
          components: [
            {
              type: 10,
              content: `## <a:12104crownpink:1449139449211387945> **Premium Whitelist**\n\n**Entry Granted! ✨**\n<@${targetUser.id}> has been added to your permanent whitelist. They can now bypass your room locks and join you at any time.\n\n<a:boost:1449497847094444083> **Privacy settings have been updated successfully.**`
            }
          ]
        }
      ]
    };

    await client.rest.post(Routes.channelMessages(message.channelId), { body: payload }).catch(() => {});
    
    // Auto-update the global panel if it exists
    await updateWhitelistPanel(client, message.guildId);
    return;
  }
};
