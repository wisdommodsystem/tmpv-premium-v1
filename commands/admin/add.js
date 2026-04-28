const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { addPremiumMember } = require('../../utils/premiumStorage');

module.exports = {
  name: 'add',
  description: 'Add a premium member (Admin only).',
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

    // Parse arguments: .v add premium member @user duration reason
    if (args.length < 4) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('❓ Usage')
            .setDescription('`.v add premium member @user <duration> <reason>`\n\n**Duration formats:**\n- `30d` (30 days)\n- `1h` (1 hour)\n- `permanent` (no expiration)')
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

    const duration = args[3];
    const reason = args.slice(4).join(' ') || 'No reason provided';

    // Validate duration format
    if (duration !== 'permanent' && !/^(\d+)([smhd])$/.test(duration)) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2B2D31)
            .setDescription('> <a:warning_animated:1361729714259099809> **Invalid duration format. Use: 30d, 1h, or permanent**')
            .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        ]
      });
    }

    try {
      const success = await addPremiumMember(targetUser.id, message.author.id, duration, reason);

      if (success) {
        const expiryText = duration === 'permanent' ? 'Never' : duration;

        // Send success embed
        const embed = new EmbedBuilder()
          .setColor(0x2B2D31)
          .setTitle('✅ **Premium Member Added**')
          .setDescription(`Successfully added ${targetUser} to premium members.`)
          .addFields(
            { name: '👤 User', value: `<@${targetUser.id}>`, inline: true },
            { name: '⏰ Duration', value: expiryText, inline: true },
            { name: '📝 Reason', value: reason, inline: true },
            { name: '👨‍💼 Added by', value: `<@${message.author.id}>`, inline: true }
          )
          .setThumbnail(targetUser.user.displayAvatarURL({ dynamic: true }))
          .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
          .setTimestamp();

        message.reply({ embeds: [embed] });

        // DM the user
        try {
          const dmEmbed = new EmbedBuilder()
            .setColor(0x2B2D31)
            .setTitle('🎉 **Welcome to Premium!**')
            .setDescription(`Congratulations! You've been granted premium membership in **${message.guild.name}**.`)
            .addFields(
              { name: '⏰ Duration', value: expiryText, inline: true },
              { name: '📝 Reason', value: reason, inline: true }
            )
            .addFields(
              { name: '✨ Benefits', value: '• Save room settings with `.v rememberme`\n• Auto-apply settings to new channels\n• View your offer with `.v myoffer`', inline: false }
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
              .setDescription('> <a:warning_animated:1361729714259099809> **Failed to add premium member. Please try again.**')
              .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
          ]
        });
      }
    } catch (error) {
      console.error('Error in add premium member command:', error);
      message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2B2D31)
            .setDescription('> <a:warning_animated:1361729714259099809> **An error occurred while adding the member.**')
            .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        ]
      });
    }
  }
};