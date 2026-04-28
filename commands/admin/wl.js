const { EmbedBuilder, Routes } = require('discord.js');
const { getWhitelist, isPremiumMember } = require('../../utils/premiumStorage');

module.exports = {
  name: 'wl',
  description: 'Show the room whitelist or your premium whitelist.',
  execute: async (client, message, args, tempChannels) => {
    const voiceChannel = message.member.voice.channel;
    const isPremium = await isPremiumMember(message.author.id);
    
    // If NOT in a voice channel, handle as Premium Whitelist check
    if (!voiceChannel) {
      if (!isPremium) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0x2B2D31)
          .setDescription('> <a:warning_animated:1361729714259099809> **You must be in a voice channel to view room permissions, or have Premium to view your permanent whitelist.**')
          .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() });
        return message.reply({ embeds: [errorEmbed] });
      }

      // Handle as Premium Whitelist List
      const myWhitelist = await getWhitelist(message.author.id);
      const listString = (!myWhitelist || myWhitelist.length === 0) 
        ? "> *Your whitelist is currently empty.*" 
        : myWhitelist.map((id, index) => `${index + 1}. <@${id}>`).join('\n');

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
                content: `## <a:12104crownpink:1449139449211387945> **Permanent Whitelist**\n\n${listString}\n\n<a:boost:1449497847094444083> *These users have permanent access to your private channels.*`
              }
            ]
          }
        ]
      };
      await client.rest.post(Routes.channelMessages(message.channelId), { body: listPayload }).catch(() => {});
      return;
    }

    // Existing logic for Room Whitelist
    const channelData = tempChannels.get(voiceChannel.id);

    if (!channelData || !channelData.allowedUsers || channelData.allowedUsers.length === 0) {
      const emptyEmbed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle('📋 القائمة البيضاء')
        .setDescription('لا يوجد مستخدمون في القائمة البيضاء حالياً')
        .addFields(
          { name: '🎤 القناة', value: voiceChannel.name, inline: true },
          { name: '<:voice2:1358152471687467228> العدد', value: '0', inline: true }
        )
        .setThumbnail('https://i.ibb.co/Qp1SXBz/wisdom-logo.png')
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();
      return message.reply({ embeds: [emptyEmbed] });
    }

    const whitelist = channelData.allowedUsers.map(id => `<@${id}>`).join('\n');
    
    const whitelistEmbed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setTitle('✅ القائمة البيضاء')
      .setDescription('المستخدمون المسموح لهم بالدخول:')
      .addFields(
        { name: '👥 المستخدمون المسموحون', value: whitelist, inline: false },
        { name: '🎤 القناة', value: voiceChannel.name, inline: true },
        { name: '<:voice2:1358152471687467228> العدد', value: channelData.allowedUsers.length.toString(), inline: true }
      )
      .setThumbnail('https://i.ibb.co/Qp1SXBz/wisdom-logo.png')
      .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
      .setTimestamp();

    message.reply({ embeds: [whitelistEmbed] });
  }
};
