const { EmbedBuilder } = require('discord.js');
const { saveRoomSettings } = require('../../utils/premiumStorage');

module.exports = {
  name: 'rememberme',
  description: 'Save your current room settings for future channels.',
  execute: async (client, message, args, tempChannels) => {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2B2D31)
            .setDescription('> <a:warning_animated:1361729714259099809> **You must be in a voice channel!**')
            .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        ]
      });
    }

    const channelData = tempChannels.get(voiceChannel.id);
    if (!channelData || channelData.ownerId !== message.author.id) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2B2D31)
            .setDescription('> <a:warning_animated:1361729714259099809> **You are not the owner of this channel!**')
            .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        ]
      });
    }

    try {
      // Get current channel settings
      const targetRoleId = process.env.TEMP_ROOM_ROLE_ID || message.guild.id;
      const permissions = voiceChannel.permissionOverwrites.cache.get(targetRoleId);
      const isLocked = permissions?.deny?.has('Connect') || false;
      const isHidden = permissions?.deny?.has('ViewChannel') || false;

      const settings = {
        name: voiceChannel.name,
        userLimit: voiceChannel.userLimit || null,
        locked: isLocked,
        hidden: isHidden,
        savedAt: new Date()
      };

      const success = await saveRoomSettings(message.author.id, settings);

      if (success) {
        message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x2B2D31)
              .setTitle('💾 **Settings Saved!**')
              .setDescription('Your room settings have been saved successfully. They will be applied to your future channels.')
              .addFields(
                { name: '📝 Name', value: settings.name, inline: true },
                { name: '👥 Limit', value: settings.userLimit ? settings.userLimit.toString() : 'Unlimited', inline: true },
                { name: '🔒 Status', value: settings.locked ? 'Locked' : 'Unlocked', inline: true },
                { name: '👁️ Visibility', value: settings.hidden ? 'Hidden' : 'Visible', inline: true }
              )
              .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
              .setTimestamp()
          ]
        });
      } else {
        message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x2B2D31)
              .setDescription('> <a:warning_animated:1361729714259099809> **Failed to save settings. Please try again.**')
              .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
          ]
        });
      }
    } catch (error) {
      console.error('Error in rememberme command:', error);
      message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2B2D31)
            .setDescription('> <a:warning_animated:1361729714259099809> **An error occurred while saving settings.**')
            .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        ]
      });
    }
  }
};