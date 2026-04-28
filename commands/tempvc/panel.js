const { PermissionFlagsBits, Routes, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'panel',
  description: 'Show the professional channel control panel V2.',
  execute: async (client, message, args, tempChannels) => {
    const voiceChannel = message.member.voice.channel;

    const sendError = async (msg) => {
      const errorPayload = {
        flags: 32768,
        components: [{
          type: 17,
          accent_color: 0xE74C3C,
          components: [{
            type: 10,
            content: `> <a:warning_animated:1361729714259099809> **${msg}**`
          }]
        }]
      };
      return message.reply({ content: '', ...errorPayload });
    };

    if (!voiceChannel) return sendError('خاصك تكون ف شانيل صوتي باش تستعمل هاد الأمر!');

    const channelData = tempChannels.get(voiceChannel.id);
    if (!channelData) return sendError('هادي ماشي شانيل مؤقت!');
    if (channelData.ownerId !== message.author.id) return sendError('غير المالك لي يقدر يستعمل التابلو!');

    const targetRoleId = process.env.TEMP_ROOM_ROLE_ID || message.guild.id;
    const permissions = voiceChannel.permissionOverwrites.cache.get(targetRoleId);

    const isLocked = permissions?.deny?.has(PermissionFlagsBits.Connect) || false;
    const isHidden = permissions?.deny?.has(PermissionFlagsBits.ViewChannel) || false;

    const payload = {
      flags: 32768, // IS_COMPONENTS_V2
      components: [
        {
          type: 17, // CONTAINER
          accent_color: 2829617, // 0x2B2D31
          components: [
            {
              type: 12, // IMAGE
              items: [{ media: { url: "https://i.postimg.cc/3R5hgh1W/download.gif" } }]
            }
          ]
        },
        {
          type: 1, // Action Row 1
          components: [
            new ButtonBuilder().setCustomId('panel_lock').setLabel('LOCK').setEmoji('<:voice3:1358152470081175622>').setStyle(isLocked ? ButtonStyle.Success : ButtonStyle.Secondary).toJSON(),
            new ButtonBuilder().setCustomId('panel_unlock').setLabel('UNLOCK').setEmoji('<:voice1:1358152473403195555>').setStyle(!isLocked ? ButtonStyle.Success : ButtonStyle.Secondary).toJSON(),
            new ButtonBuilder().setCustomId('panel_rename').setLabel('RENAME').setEmoji('<:voice6:1358152460979404992>').setStyle(ButtonStyle.Primary).toJSON(),
            new ButtonBuilder().setCustomId('panel_limit').setLabel('LIMIT').setEmoji('<:voice4:1358152468273430718>').setStyle(ButtonStyle.Primary).toJSON(),
            new ButtonBuilder().setCustomId('panel_hide').setLabel('HIDE').setEmoji('<a:Red_Eye:1450210370487718071>').setStyle(isHidden ? ButtonStyle.Success : ButtonStyle.Secondary).toJSON()
          ]
        },
        {
          type: 1, // Action Row 2
          components: [
            new ButtonBuilder().setCustomId('panel_unhide').setLabel('UNHIDE').setEmoji('<a:Eyes:1450279319971823789>').setStyle(!isHidden ? ButtonStyle.Success : ButtonStyle.Secondary).toJSON(),
            new ButtonBuilder().setCustomId('panel_kick_all').setLabel('KICK ALL').setEmoji('<a:sssss:1450241657261002864>').setStyle(ButtonStyle.Danger).toJSON(),
            new ButtonBuilder().setCustomId('panel_transfer').setLabel('TRANSFER').setEmoji('<a:12104crownpink:1449139449211387945>').setStyle(ButtonStyle.Primary).toJSON(),
            new ButtonBuilder().setCustomId('panel_info').setLabel('INFO').setEmoji('<:voice2:1358152471687467228>').setStyle(ButtonStyle.Secondary).toJSON(),
            new ButtonBuilder().setCustomId('panel_delete').setLabel('DELETE').setEmoji('<:trash:1450280880881930341>').setStyle(ButtonStyle.Danger).toJSON()
          ]
        }
      ]
    };

    try {
      await message.delete().catch(() => { });
      await client.rest.post(Routes.channelMessages(message.channelId), { body: payload });
    } catch (error) {
      console.error('Error sending V2 Panel:', error);
    }
  }
};
