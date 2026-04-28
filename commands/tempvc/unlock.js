const { EmbedBuilder, PermissionFlagsBits, Routes } = require('discord.js');
const { setVoiceStatus } = require('../../utils/helpers');
const { getWhitelist } = require('../../utils/premiumStorage');

module.exports = {
  name: 'unlock',
  description: 'Unlock the voice channel.',
  execute: async (client, message, args, tempChannels) => {
    const sendErrorV2 = async (msg) => {
        const payload = {
          flags: 32768, // IS_COMPONENTS_V2
          message_reference: { message_id: message.id },
          components: [{
            type: 17, // CONTAINER
            accent_color: 15548997, // Red
            components: [{
              type: 10,
              content: `## 🚫 **Room Error**\n\n> ${msg}`
            }]
          }]
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
        await sendErrorV2('This is not a registered temporary channel!');
        return;
    }

    if (channelData.ownerId !== message.author.id) {
        await sendErrorV2('You are not the official owner of this channel!');
        return;
    }

    const targetRoleId = process.env.TEMP_ROOM_ROLE_ID || message.guild.id;

    try {
      // 1. Reset primary role permissions
      await voiceChannel.permissionOverwrites.edit(targetRoleId, {
        [PermissionFlagsBits.Connect]: true,
        [PermissionFlagsBits.Speak]: true,
        [PermissionFlagsBits.ViewChannel]: true
      });

      // 2. Sync members and WHITELIST
      const myWhitelist = await getWhitelist(message.author.id);
      const membersInChannel = voiceChannel.members;

      // Ensure whitelist access regardless of current state
      if (myWhitelist && myWhitelist.length > 0) {
        for (const id of myWhitelist) {
          await voiceChannel.permissionOverwrites.edit(id, {
            [PermissionFlagsBits.Connect]: true,
            [PermissionFlagsBits.ViewChannel]: true,
            [PermissionFlagsBits.Speak]: true,
            [PermissionFlagsBits.SendMessages]: true,
            [PermissionFlagsBits.ReadMessageHistory]: true
          }).catch(() => {});
        }
      }

      // Sync others
      for (const [memberId, member] of membersInChannel) {
        if (memberId === channelData.ownerId) continue;
        if (channelData.rejectedUsers?.includes(memberId)) continue;
        if (myWhitelist?.includes(memberId)) continue; // Already handled above

        await voiceChannel.permissionOverwrites.edit(memberId, {
          [PermissionFlagsBits.Connect]: true,
          [PermissionFlagsBits.Speak]: true,
          [PermissionFlagsBits.ViewChannel]: true
        }).catch(() => { });
      }

      // 3. Update voice status
      await setVoiceStatus(voiceChannel.id, client.token, '**.v help/panel**  <a:FZ_red_cross:1360451122807963770>');

      const successEmbed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle(`<:voice1:1358152473403195555> **Room Unlocked**`)
        .setDescription(`> <a:notif:1447321335117123610> **The channel is now open for everyone.**`)
        .addFields(
          { name: `🎤 Channel`, value: `${voiceChannel.name}`, inline: true },
          { name: `👑 Owner`, value: `<@${message.author.id}>`, inline: true }
        )
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

      message.reply({ embeds: [successEmbed] });
    } catch (error) {
       await sendErrorV2('Failed to unlock the channel. Please verify my permissions.');
    }
  }
};