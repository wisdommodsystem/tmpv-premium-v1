const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { loadBlacklist } = require('../../utils/blacklistStorage');

module.exports = {
  name: 'blist',
  description: 'Show a list of all blacklisted users.',
  execute: async (client, message, args, tempChannels) => {
    // Permissions check
    const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
    const hasPermission = message.member.permissions.has(PermissionFlagsBits.Administrator) || 
                          (ADMIN_ROLE_ID && message.member.roles.cache.has(ADMIN_ROLE_ID));

    if (!hasPermission) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#E74C3C')
        .setTitle('🚫 Access Denied')
        .setDescription('> This command is restricted to **Wisdom Boosters 🚀**')
        .setFooter({ text: 'Wisdom TMPV - S Version ©' })
        .setTimestamp();
      return message.reply({ embeds: [errorEmbed] });
    }

    const blacklist = loadBlacklist();
    const userIds = Object.keys(blacklist);

    if (userIds.length === 0) {
      const emptyEmbed = new EmbedBuilder()
        .setColor(0x2ECC71) // Green
        .setTitle('📜 Blacklist Ledger')
        .setDescription('> **The blacklist is currently empty!** 🎉\n> No users are restricted at this time.')
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();
      return message.reply({ embeds: [emptyEmbed] });
    }

    const arrow = '<a:wisdoarrow:1453486894779338885>';
    let listContent = '';

    // Limit to 15 users to prevent hitting the embed description limit
    const displayCount = Math.min(userIds.length, 15);
    for (let i = 0; i < displayCount; i++) {
        const userId = userIds[i];
        const entry = blacklist[userId];
        const expiry = entry.expiresAt ? `<t:${Math.floor(entry.expiresAt / 1000)}:R>` : 'Permanent';
        listContent += `**${i + 1}.** <@${userId}>\n${arrow} **Reason:** \`${entry.reason}\` | **Expires:** ${expiry}\n\n`;
    }

    if (userIds.length > 15) {
        listContent += `\n*...and ${userIds.length - 15} more hidden entries.*`;
    }

    const embed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setTitle('📜 Blacklist Ledger')
      .setDescription(`> **Total Restricted Users:** \`${userIds.length}\`\n\n${listContent}`)
      .setThumbnail(message.guild.iconURL({ dynamic: true }))
      .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
};
