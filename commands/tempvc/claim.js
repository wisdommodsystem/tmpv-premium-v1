const { EmbedBuilder, Routes } = require('discord.js');
const { isPremiumMember } = require('../../utils/premiumStorage');

module.exports = {
  name: 'claim',
  description: 'Claim ownership if the current owner left.',
  execute: async (client, message, args, tempChannels) => {
    const sendErrorV2 = async (msg) => {
      const payload = {
        flags: 32768, // IS_COMPONENTS_V2
        message_reference: { message_id: message.id },
        components: [
          {
            type: 17, // CONTAINER
            accent_color: 15548997, // Red
            components: [
              {
                type: 10,
                content: `## 🚫 **Command Error**\n\n> ${msg}`
              }
            ]
          }
        ]
      };
      await client.rest.post(Routes.channelMessages(message.channelId), { body: payload }).catch(() => {});
    };

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        await sendErrorV2('You must be in a voice channel to use this command!');
        return;
    }

    const channelData = tempChannels.get(voiceChannel.id);
    if (!channelData) {
        await sendErrorV2('This is not a temporary channel!');
        return;
    }

    // --- Offer2/Offer3 Anti-Claim Protection ---
    let ownerPremium = channelData.isPremium || null;
    if (!ownerPremium && channelData.ownerId) {
      ownerPremium = await isPremiumMember(channelData.ownerId);
    }
    if (ownerPremium) {
      await sendErrorV2('You cannot claim this room! It is fully shielded by **WS TMPV Premium** immunity.');
      return;
    }
    // -------------------------------------------

    if (channelData.ownerId === message.author.id) {
      await sendErrorV2('You are already the owner of this channel!');
      return;
    }

    // Owner must have left the channel
    if (voiceChannel.members.has(channelData.ownerId)) {
      await sendErrorV2('The current owner is still in the channel!');
      return;
    }

    // ── SMART CLAIM: Check if 5 minutes have passed since owner left ───────
    if (channelData.ownerLeftAt) {
      const remainingSeconds = Math.floor((300000 - (Date.now() - channelData.ownerLeftAt)) / 1000);
      if (remainingSeconds > 0) {
        const remainingMinutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        await sendErrorV2(`The owner recently left. You must wait for the 5-minute grace period before claiming ownership.\n**Remaining:** ${remainingMinutes}m ${seconds}s`);
        return;
      }
    }
    // ───────────────────────────────────────────────────────────────────

    // Grant new owner permissions
    await voiceChannel.permissionOverwrites.edit(message.author.id, {
      Connect: true,
      ViewChannel: true,
      Stream: true,
      Speak: true,
      UseVAD: true,
      PrioritySpeaker: true
    });

    // ── FIX: revoke old owner's ManageChannels so they can't manage after leaving ──
    const oldOwnerId = channelData.ownerId;
    await voiceChannel.permissionOverwrites.edit(oldOwnerId, {
      ManageChannels: false,
      PrioritySpeaker: false
    }).catch(() => { }); // old owner may not have an overwrite
    // ──────────────────────────────────────────────────────────────────────────────

    channelData.ownerId = message.author.id;
    delete channelData.ownerLeftAt; // Clear the timestamp after successful claim

    message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2B2D31)
          .setTitle('<a:12104crownpink:1449139449211387945> Channel Claimed')
          .setDescription('You have successfully claimed ownership of this channel!')
          .addFields(
            { name: '🎤 Channel', value: voiceChannel.name, inline: true },
            { name: '👤 New Owner', value: `<@${message.author.id}>`, inline: true },
            { name: '⚡ Permissions', value: 'Manage Channel, Stream, Speak, Priority Speaker', inline: false }
          )
          .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
          .setTimestamp()
      ]
    });
  }
};
