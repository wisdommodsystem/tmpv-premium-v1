const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'help',
  description: 'Show help information in the current channel.',
  execute: async (client, message) => {
    const helpEmbed = new EmbedBuilder()
      .setTitle('📚 **WISDOM HELP CENTER**')
      .setColor(0x2B2D31)
      .setAuthor({
        name: 'Wisdom TEMP System',
        iconURL: client.user.displayAvatarURL()
      })
      .setDescription(`
        > <a:boost:1449497847094444083> **Your Voice Control Center**
        > Prefix: \`.v\`  •  Use commands inside your room
      `)
      .addFields(
        {
          name: '<:voice3:1358152470081175622> **Room Control**',
          value: [
            '`lock` / `unlock` — privacy (join)',
            '`hide` / `unhide` — visibility',
            '`limit <n>` — member cap',
            '`name <text>` — rename room',
            '`top` — move room to top (voice only)'
          ].join('\n'),
          inline: false
        },
        {
          name: '<a:org:1449141144268308595> **User Manager**',
          value: [
            '`invite @user` — invite user',
            '`permit @user` — allow access',
            '`reject @user` — block access',
            '`kick @user` — remove from room',
            '`transfer @user` — transfer ownership',
            '`claim` — claim empty room'
          ].join('\n'),
          inline: true
        },
        {
          name: '<:voice2:1358152471687467228> **Utilities**',
          value: [
            '`panel` — control panel (buttons)',
            '`vcinfo` — room info',
            '`save <time>` — protect from auto-delete',
            '`status` — show room status'
          ].join('\n'),
          inline: true
        },
        {
          name: '👑 **WS TMPV Premium**',
          value: [
            '`myoffer` — perks & expiry',
            '`phelp` — premium quick help',
            '`whitelist @user` — permanent access',
            '`unwhitelist @user` — remove access',
            '`whitelistlist` — view list',
            '`safehouse` / `sh` — anti-abuse (admin limit-bypass)'
          ].join('\n'),
          inline: false
        }
      )
      .setImage('https://i.ibb.co/mk6Tj1r/autovc.gif')
      .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'Wisdom TMPV - S Version © • Use .v phelp (Premium)', iconURL: client.user.displayAvatarURL() })
      .setTimestamp();

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('panel_info') // Reusing an existing ID or a simple one that triggers panel
          .setLabel('Vc INFOS ')
          .setEmoji('<a:info:1454901148547940442>')
          .setStyle(ButtonStyle.Secondary)
      );

    // Send the embed
    message.channel.send({ embeds: [helpEmbed], components: [row] });
  }
};
