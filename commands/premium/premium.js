const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { addPremiumMember } = require('../../utils/premiumStorage');

module.exports = {
  name: 'premium',
  description: 'Grant Ws TMPV Premium access.',
  execute: async (client, message, args) => {
    const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
    const hasPermission = message.member.permissions.has(PermissionFlagsBits.Administrator) || 
                          (ADMIN_ROLE_ID && message.member.roles.cache.has(ADMIN_ROLE_ID));

    if (!hasPermission) {
      return message.reply({ content: '❌ **Access Denied:** You lack the necessary permissions to use this command!' });
    }

    // .v premium @user 30d
    const targetUser = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
    if (!targetUser) return message.reply({ content: '❌ **Usage:** `.v premium @user <duration>`' });

    let timeParam = (args[1] || 'permanent').toLowerCase();
    if (timeParam === 'perm') timeParam = 'permanent';
    const offer = 'ws_tmpv_premium';

    const success = await addPremiumMember(targetUser.id, message.author.id, timeParam, offer, 'Admin Granted');
    if (success) {
      const embed = new EmbedBuilder()
        .setColor(0xF1C40F) // Gold
        .setTitle('👑 **PREMIUM GRANTED**')
        .setDescription(`**Success!** **WS TMPV PREMIUM** has been granted to <@${targetUser.id}>.\n> **Duration:** \`${timeParam}\``)
        .setFooter({ text: 'Wisdom TMPV - S Version ©' })
        .setTimestamp();
      message.reply({ embeds: [embed] });
    } else {
      message.reply({ content: '❌ **Database Error:** Failed to update the premium registry.' });
    }
  }
};
