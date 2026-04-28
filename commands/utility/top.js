const { EmbedBuilder, ChannelType } = require('discord.js');
const { isPremiumMember } = require('../../utils/premiumStorage');

module.exports = {
  name: 'top',
  description: 'Move your temp voice channel to the top (Premium only).',
  execute: async (client, message, args, tempChannels) => {
    const voiceChannel = message.member.voice.channel;
    
    if (!voiceChannel) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setDescription('> <a:warning_animated:1361729714259099809> **You must be in a voice channel to use this command!**')
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() });
      return message.reply({ embeds: [errorEmbed] });
    }
    
    const channelData = tempChannels.get(voiceChannel.id);

    if (!channelData) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setDescription('> <a:warning_animated:1361729714259099809> **This is not a temporary channel!**')
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() });
      return message.reply({ embeds: [errorEmbed] });
    }

    // Check if the user is the owner of the channel
    if (channelData.ownerId !== message.author.id) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setDescription('> <a:warning_animated:1361729714259099809> **You are not the owner of this channel!**')
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() });
      return message.reply({ embeds: [errorEmbed] });
    }

    const premium = await isPremiumMember(message.author.id);
    if (!premium) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setDescription('> <a:warning_animated:1361729714259099809> **This command is available for WS TMPV Premium only.**')
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() });
      return message.reply({ embeds: [errorEmbed] });
    }

    if (!voiceChannel.parentId) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setDescription('> <a:warning_animated:1361729714259099809> **This channel is not inside a category.**')
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() });
      return message.reply({ embeds: [errorEmbed] });
    }

    const voiceChannels = message.guild.channels.cache
      .filter(ch => ch.parentId === voiceChannel.parentId && ch.type === ChannelType.GuildVoice)
      .sort((a, b) => a.rawPosition - b.rawPosition);

    // First possible slot among voice channels in this category
    const firstVoiceRaw = voiceChannels.first()?.rawPosition ?? voiceChannel.rawPosition;

    // Reorder only voice channels: requested channel first, then the rest
    const reordered = [
      voiceChannel,
      ...voiceChannels.filter(ch => ch.id !== voiceChannel.id).values()
    ];

    const bulkPositions = reordered.map((ch, index) => ({
      channel: ch.id,
      position: firstVoiceRaw + index
    }));

    await message.guild.channels.setPositions(bulkPositions);
    
    const successEmbed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setTitle('⬆️ تم نقل القناة للأعلى')
      .setDescription('تم نقل القناة الصوتية إلى أعلى قائمة الفئة بنجاح!')
      .addFields(
        { name: '🎤 القناة', value: voiceChannel.name, inline: true },
        { name: '👤 بواسطة', value: `<@${message.author.id}>`, inline: true },
        { name: '📍 الموقع الجديد', value: 'أعلى القائمة', inline: true }
      )
      .setThumbnail(message.guild.iconURL({ dynamic: true }))
      .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
      .setTimestamp();
    
    message.reply({ embeds: [successEmbed] });
  }
};
