const { EmbedBuilder, PermissionFlagsBits, Routes } = require('discord.js');
const { setVoiceStatus } = require('../../utils/helpers');
const { getWhitelist } = require('../../utils/premiumStorage');

module.exports = {
  name: 'lock',
  description: 'Lock the voice channel.',
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
      // 1. Lock the room for the primary role/everyone
      await voiceChannel.permissionOverwrites.edit(targetRoleId, { 
          [PermissionFlagsBits.Connect]: false 
      });

      // 2. Ensure Whitelist members RETAIN access
      const myWhitelist = await getWhitelist(message.author.id);
      if (myWhitelist && myWhitelist.length > 0) {
          for (const id of myWhitelist) {
              await voiceChannel.permissionOverwrites.edit(id, { 
                  [PermissionFlagsBits.Connect]: true,
                  [PermissionFlagsBits.ViewChannel]: true
              }).catch(() => {});
          }
      }

      // 3. Update voice status
      await setVoiceStatus(voiceChannel.id, client.token, '<:lock:1452014333965111398>  **Room: Locked**');

      const successEmbed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle(`<:voice3:1358152470081175622> **Room Shielded**`)
        .setDescription(`> <a:notif:1447321335117123610> **The channel is now restricted.**\n> Whitelisted friends can still join!`)
        .addFields(
          { name: `🎤 Channel`, value: `${voiceChannel.name}`, inline: true },
          { name: `👑 Owner`, value: `<@${message.author.id}>`, inline: true }
        )
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

      message.reply({ embeds: [successEmbed] });
    } catch (error) {
       await sendErrorV2('Failed to lock the channel. Please verify my permissions.');
    }
  }
};