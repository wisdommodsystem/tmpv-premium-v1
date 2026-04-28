const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'offershelp',
  description: 'Show details and commands for the Premium Offers system.',
  execute: async (client, message, args) => {
    // Strict admin-only access
    const hasPermission = message.member.permissions.has(PermissionFlagsBits.Administrator);

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
                content: `## 🚫 **Access Denied**\n\n> This command is restricted to **Server Admins only**.`
              }
            ]
          }
        ]
      };
      await client.rest.post(Routes.channelMessages(message.channelId), { body: errorV2 }).catch(() => { });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xF1C40F) // Gold/Yellow
      .setAuthor({ name: '🌟 Premium Offers Management', iconURL: message.guild.iconURL({ dynamic: true }) })
      .setDescription(`
        > **Welcome to the Premium Offers System!**
        > This system allows you to grant exclusive VIP privileges to server supporters.

        **<a:12104crownpink:1449139449211387945> WS TMPV Premium**
        - **Luxury Welcome:** Receives a dedicated Components V2 luxury card when the room is created.
        - **Private Text Channel:** A private text space is created automatically for the owner.
        - **Open Panel Button:** Includes an instant **Open Diamond Panel** button to launch controls quickly.
        - **Zero Cooldowns:** Fast control actions with no waiting.
        - **Anti-Claim Shield:** Premium room ownership cannot be claimed by others.
        - **Palace Identity:** Elite room naming and prestige status.

        **🛠️ Administrative Commands:**
        - \`.v premium @user <duration>\` — Grant WS TMPV Premium.
        *Hint: Durations can be \`1h\`, \`30d\`, or \`perm\`.*
        - \`.v plist\` — View a detailed list of all premium members and their tiers.
      `)
      .setThumbnail(client.user.displayAvatarURL())
      .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
};
