const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'bhelp',
  description: 'Show the blacklist help menu.',
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

    const arrow = '<a:wisdoarrow:1453486894779338885>';

    const embed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setAuthor({ name: '🔐 Blacklist Management System', iconURL: message.guild.iconURL({ dynamic: true }) })
      .setDescription(`
        > **Welcome to the Blacklist Menu!**
        > This system allows you to restrict disruptive users from creating temporary voice channels.
        
        **${arrow} Restrict a User (Blacklist):**
        \`\`\`.v blacklist @user <time> <reason>\`\`\`
        Instantly kicks the user from the "Create Room" channel and restricts their access. They will receive a DM notification.
        **Time Formats:**
        - \`1m\` (1 Minute)
        - \`1h\` (1 Hour)
        - \`1d\` (1 Day)
        - \`perm\` (Permanent)
        
        **${arrow} Pardon a User (Remove Blacklist):**
        \`\`\`.v rblacklist @user\`\`\`
        Lifts the restriction and cleanly restores their ability to create temporary rooms.

        *⚠️ Note: This system is strictly for server administration.*
      `)
      .setThumbnail(client.user.displayAvatarURL())
      .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
};
