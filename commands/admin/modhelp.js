const { Routes } = require('discord.js');

module.exports = {
  name: 'modhelp',
  description: 'Display an interactive moderator help panel with categorized commands.',
  execute: async (client, message, args) => {
    // Check admin permissions
    const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
    const hasPermission = message.member.permissions.has('Administrator') ||
        (ADMIN_ROLE_ID && message.member.roles.cache.has(ADMIN_ROLE_ID));

    if (!hasPermission) {
      const errorPayload = {
        flags: 32768, // IS_COMPONENTS_V2
        message_reference: { message_id: message.id },
        components: [
          {
            type: 17, // CONTAINER
            accent_color: 15548997, // Red
            components: [
              {
                type: 10,
                content: `## 🚫 **Access Denied**\n\n> This command is reserved for **Staff Members** only.`
              }
            ]
          }
        ]
      };
      await client.rest.post(Routes.channelMessages(message.channelId), { body: errorPayload }).catch(() => {});
      return;
    }

    const helpPayload = {
      flags: 32768, // IS_COMPONENTS_V2
      message_reference: { message_id: message.id },
      components: [
        {
          type: 17, // CONTAINER
          accent_color: 3447003, // Diamond Blue
          components: [
            {
              type: 10,
              content: `## 🛠️ **System Management Center**\n\n> **Welcome, Moderator.** Select a category from the menu below to explore administrative, system, and core command documentation.\n\n<a:boost:1449497847094444083> **Wisdom TMPV - Administrative Interface**`
            },
            {
                type: 1, // ActionRow for Select Menu
                components: [
                    {
                        type: 3, // String Select Menu
                        custom_id: 'modhelp_menu',
                        placeholder: 'Select a command category...',
                        options: [
                            { label: 'Admin & System', value: 'mod_admin', description: 'Core system and administrative controls.', emoji: { name: '🛡️' } },
                            { label: 'Premium & Billing', value: 'mod_premium', description: 'Manage subscriber tiers and whitelist pools.', emoji: { name: '💎' } },
                            { label: 'Voice Management', value: 'mod_voice', description: 'Temporary room control and member handling.', emoji: { name: '🎙️' } },
                            { label: 'Utility & Tools', value: 'mod_utility', description: 'Diagnostic tools and general server utilities.', emoji: { name: '⚙️' } }
                        ]
                    }
                ]
            }
          ]
        }
      ]
    };

    await client.rest.post(Routes.channelMessages(message.channelId), { body: helpPayload }).catch(() => {});
  }
};
