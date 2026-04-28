const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { removePremiumMember } = require('../../utils/premiumStorage');

module.exports = {
  name: 'remove',
  description: 'Remove a premium member (Admin only).',
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

    // Parse arguments: .v remove premium member @user reason
    if (args.length < 4) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('❓ Usage')
            .setDescription('`.v remove premium member @user <reason>`')
            .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        ]
      });
    }

    const targetUser = message.mentions.members.first();
    if (!targetUser) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2B2D31)
            .setDescription('> <a:warning_animated:1361729714259099809> **Please mention a valid user.**')
            .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        ]
      });
    }

    const reason = args.slice(3).join(' ') || 'No reason provided';

    try {
      const success = await removePremiumMember(targetUser.id, message.author.id, reason);

      if (success) {
        // Send success embed
        const embed = new EmbedBuilder()
          .setColor(0x2B2D31)
          .setTitle('✅ **Premium Member Removed**')
          .setDescription(`Successfully removed ${targetUser} from premium members.`)
          .addFields(
            { name: '👤 User', value: `<@${targetUser.id}>`, inline: true },
            { name: '📝 Reason', value: reason, inline: true },
            { name: '👨‍💼 Removed by', value: `<@${message.author.id}>`, inline: true }
          )
          .setThumbnail(targetUser.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
          .setTimestamp();

        message.reply({ embeds: [embed] });

        // DM the user
        try {
          const dmEmbed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('😔 **Premium Membership Revoked**')
            .setDescription(`Your premium membership in **${message.guild.name}** has been revoked.`)
            .addFields(
              { name: '📝 Reason', value: reason, inline: true },
              { name: '👨‍💼 Removed by', value: `<@${message.author.id}>`, inline: true }
            )
            .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() });

          await targetUser.send({ embeds: [dmEmbed] });
        } catch (dmError) {
          // Ignore DM errors
        }
      } else {
        message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x2B2D31)
              .setDescription('> <a:warning_animated:1361729714259099809> **Failed to remove premium member. Please try again.**')
              .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
          ]
        });
      }
    } catch (error) {
      console.error('Error in remove premium member command:', error);
      message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2B2D31)
            .setDescription('> <a:warning_animated:1361729714259099809> **An error occurred while removing the member.**')
            .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        ]
      });
    }
  }
};