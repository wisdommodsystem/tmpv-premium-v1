const { Routes } = require('discord.js');
const { isPremiumMember } = require('../../utils/premiumStorage');

module.exports = {
  name: 'phelp',
  description: 'Show premium user commands only.',
  execute: async (client, message) => {
    const premium = await isPremiumMember(message.author.id);

    if (!premium) {
      const payload = {
        flags: 32768, // IS_COMPONENTS_V2
        message_reference: { message_id: message.id },
        components: [
          {
            type: 17,
            accent_color: 2303786,
            components: [
              {
                type: 10,
                content:
                  '## 🚫 **Premium Only**\n\n> This command is available for **WS TMPV Premium** members.\n> Use `.v myoffer` to view your status.'
              }
            ]
          },
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: 'Unlock Premium',
                url: process.env.HOW_BUY_OFFER || 'https://discord.com',
                emoji: { name: '💳' }
              }
            ]
          }
        ]
      };

      await client.rest.post(Routes.channelMessages(message.channelId), { body: payload }).catch(() => {});
      return;
    }

    const payload = {
      flags: 32768, // IS_COMPONENTS_V2
      message_reference: { message_id: message.id },
      components: [
        {
          type: 17, // CONTAINER
          accent_color: 16766720, // Gold
          components: [
            {
              type: 10,
              content: `## 👑 **WS TMPV Premium — Quick Help**\n\n> Clean, fast commands to control your room.`
            },
            {
              type: 14 // SEPARATOR
            },
            {
              type: 10,
              content:
                [
                  '**Core**',
                  '` .v panel ` — open controls (lock / hide / rename / limit / transfer / delete).',
                  '` .v top ` — move your voice room to the top (among voice channels in category).',
                  '` .v save 1h ` — protect the room from auto-delete (max `5h`).',
                  '',
                  '**Access**',
                  '` .v whitelist @user ` — permanent access (bypass lock).',
                  '` .v unwhitelist @user ` — remove access.',
                  '` .v whitelistlist ` — view your list.',
                  '',
                  '**Anti-Abuse**',
                  '` .v safehouse ` / ` .v sh ` — protect limited rooms from admin limit-bypass.',
                  '',
                  '**Status**',
                  '` .v myoffer ` — your perks & expiry.'
                ].join('\n')
            },
            {
              type: 14 // SEPARATOR
            },
            {
              type: 10,
              content: 'Tip: run `.v panel` inside your room for the fastest control.'
            }
          ]
        }
      ]
    };

    await client.rest.post(Routes.channelMessages(message.channelId), { body: payload }).catch(() => {});
  }
};
