const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { clearAllPremiumMembers } = require('../../utils/premiumStorage');

module.exports = {
  name: 'clearpremium',
  description: 'Wipe all premium users from the database. Requires special password.',
  execute: async (client, message, args) => {
    const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
    const hasPermission = message.member.permissions.has(PermissionFlagsBits.Administrator) ||
      (ADMIN_ROLE_ID && message.member.roles.cache.has(ADMIN_ROLE_ID));

    if (!hasPermission) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#E74C3C')
        .setTitle('🚫 Access Denied')
        .setDescription('> This command is restricted to **Wisdom Team ⭕**')
        .setFooter({ text: 'Wisdom TMPV - S Version ©' })
        .setTimestamp();
      return message.reply({ embeds: [errorEmbed] });
    }

    if (args[0] !== 'ws2003') {
      const passErrEmbed = new EmbedBuilder()
        .setColor('#E74C3C')
        .setTitle('🚫 Invalid Password')
        .setDescription('> **Authentication Failed!** The password provided is incorrect.')
        .setFooter({ text: 'Wisdom TMPV - S Version ©' })
        .setTimestamp();
      return message.reply({ embeds: [passErrEmbed] });
    }

    const success = await clearAllPremiumMembers();

    if (success) {
      const successEmbed = new EmbedBuilder()
        .setColor('#E74C3C') // Red for danger/destruction
        .setTitle('⚠️ SYSTEM PURGE COMPLETE')
        .setDescription('> **All Premium memberships have been successfully wiped from the central database.**\n> *The system has been completely reset.*')
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();
      return message.reply({ embeds: [successEmbed] });
    } else {
      return message.reply({ content: '❌ **Database Error:** Failed to clear the premium registry.' });
    }
  }
};
