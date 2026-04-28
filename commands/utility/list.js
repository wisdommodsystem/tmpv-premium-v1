const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { listPremiumMembers } = require('../../utils/premiumStorage');

module.exports = {
  name: 'list',
  description: 'List all premium members (Admin only).',
  execute: async (client, message, args) => {
    // Check admin permissions
    const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
    const hasPermission = message.member.permissions.has(PermissionFlagsBits.Administrator) ||
        (ADMIN_ROLE_ID && message.member.roles.cache.has(ADMIN_ROLE_ID));

    if (!hasPermission) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('🚫 Access Denied')
            .setDescription('This command is restricted to administrators only.')
            .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        ]
      });
    }

    try {
      const members = await listPremiumMembers();

      if (members.length === 0) {
        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x2B2D31)
              .setTitle('📋 **Premium Members**')
              .setDescription('No premium members found.')
              .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
              .setTimestamp()
          ]
        });
      }

      // Group members and create embed
      const embed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle('📋 **Premium Members**')
        .setDescription(`Total: ${members.length} members`)
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

      // Add fields for each member
      for (let i = 0; i < Math.min(members.length, 10); i++) {
        const member = members[i];
        const user = await client.users.fetch(member.userId).catch(() => null);
        const username = user ? user.username : 'Unknown User';

        const expiryText = member.expiresAt
          ? `<t:${Math.floor(member.expiresAt.getTime() / 1000)}:R>`
          : 'Never';

        embed.addFields({
          name: `${i + 1}. ${username}`,
          value: `ID: \`${member.userId}\`\nExpires: ${expiryText}\nAdded: <t:${Math.floor(member.addedAt.getTime() / 1000)}:R>`,
          inline: true
        });
      }

      if (members.length > 10) {
        embed.setDescription(`Total: ${members.length} members (showing first 10)`);
      }

      message.reply({ embeds: [embed] });

    } catch (error) {
      console.error('Error in list premium members command:', error);
      message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2B2D31)
            .setDescription('> <a:warning_animated:1361729714259099809> **An error occurred while fetching the list.**')
            .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        ]
      });
    }
  }
};