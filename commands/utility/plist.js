const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { listPremiumMembers } = require('../../utils/premiumStorage');

module.exports = {
  name: 'plist',
  description: 'Show a list of all active Premium/Offer users.',
  execute: async (client, message, args) => {
    const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
    const hasPermission = message.member.permissions.has(PermissionFlagsBits.Administrator) || 
                          (ADMIN_ROLE_ID && message.member.roles.cache.has(ADMIN_ROLE_ID));

    const { Routes } = require('discord.js');
    if (!hasPermission) {
      const errorV2 = {
        flags: 32768, // IS_COMPONENTS_V2
        message_reference: { message_id: message.id },
        components: [
          {
            type: 17, // CONTAINER
            accent_color: 15548997, // Red
            components: [
              {
                type: 10,
                content: `## 🚫 **Access Denied**\n\n> This command is restricted to **Wisdom Boosters 🚀**.`
              }
            ]
          }
        ]
      };
      await client.rest.post(Routes.channelMessages(message.channelId), { body: errorV2 }).catch(() => {});
      return;
    }

    const members = await listPremiumMembers();
    const activeMembers = members.filter(m => !m.expiresAt || new Date(m.expiresAt) > new Date());

    if (activeMembers.length === 0) {
      const emptyEmbed = new EmbedBuilder()
        .setColor(0x2ECC71) // Green
        .setTitle('🌟 Premium Registry')
        .setDescription('> **No active premium subscriptions found!**')
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();
      return message.reply({ embeds: [emptyEmbed] });
    }

    const arrow = '<a:wisdoarrow:1453486894779338885>';
    let listContent = '';

    // Sort by expiration (permanents first)
    activeMembers.sort((a, b) => {
        if (!a.expiresAt) return -1;
        if (!b.expiresAt) return 1;
        return new Date(a.expiresAt) - new Date(b.expiresAt);
    });

    const displayCount = Math.min(activeMembers.length, 15);
    for (let i = 0; i < displayCount; i++) {
        const entry = activeMembers[i];
        
        let offerTier = 'WS TMPV Premium 👑';

        const expiry = entry.expiresAt ? `<t:${Math.floor(new Date(entry.expiresAt).getTime() / 1000)}:R>` : 'Permanent';
        listContent += `**${i + 1}.** <@${entry.userId}>\n${arrow} **Tier:** \`${offerTier}\` | **Expires:** ${expiry}\n\n`;
    }

    if (activeMembers.length > 15) {
        listContent += `\n*...and ${activeMembers.length - 15} more active VIP members hidden.*`;
    }

    const embed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setTitle('🌟 Premium VIP Registry')
      .setDescription(`> **Total Premium Members:** \`${activeMembers.length}\`\n\n${listContent}`)
      .setThumbnail(message.guild.iconURL({ dynamic: true }))
      .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
};
