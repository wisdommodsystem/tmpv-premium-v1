const { Routes } = require('discord.js');
const { isPremiumMember, getPremiumMember, getWhitelist } = require('../../utils/premiumStorage');

const E = {
  crown: '<a:12104crownpink:1449139449211387945>',
  boost: '<a:boost:1449497847094444083>',
  arrow: '<a:wisdoarrow:1453486894779338885>',
  diamond: '<a:color_yellow_diamante:1449454950022119427>',
  org: '<:org:1449141144268308595>',
  star: '⭐',
  shield: '🛡️',
  zap: '⚡',
  ghost: '🕶️',
  palace: '🏛️',
  lock: '🔒'
};

const SEP = '━━━━━━━━━━━━━━━━━━';

module.exports = {
  name: 'myoffer',
  description: 'Check your premium status and benefits.',
  execute: async (client, message, args) => {
    try {
      const isPremium = await isPremiumMember(message.author.id);

      // ── No Sub ─────────────────────────────────────────────────────────────
      if (!isPremium) {
        const payload = {
          flags: 32768,
          message_reference: { message_id: message.id },
          components: [
            {
              type: 17,
              accent_color: 2303786,
              components: [
                {
                  type: 10,
                  content: `## 😶 **Hta ldb ma 3ndk walo...**\n\n> You haven't unlocked your premium potential yet.\n> Don't settle for basic — rule your own space.\n\n${SEP}\n\n**— Premium Starter Pack —**\n\n${E.boost} Access to private lounges\n${E.boost} Permanent whitelist access\n${E.boost} Infinite settings memory\n\n${SEP}\n\n${E.arrow} Grab your offer and join the elite.`
                }
              ]
            },
            {
              type: 1,
              components: [
                {
                  type: 2, style: 5,
                  label: 'Unlock Premium',
                  url: process.env.HOW_BUY_OFFER || 'https://discord.com',
                  emoji: { name: '💳' }
                }
              ]
            }
          ]
        };
        await client.rest.post(Routes.channelMessages(message.channelId), { body: payload }).catch(() => { });
        return;
      }

      const memberData = await getPremiumMember(message.author.id);
      const whitelist = await getWhitelist(message.author.id);
      const wlCount = whitelist ? whitelist.length : 0;
      const expiry = memberData.expiresAt
        ? `<t:${Math.floor(memberData.expiresAt.getTime() / 1000)}:R>`
        : '`∞  Infinite Access`';
      const since = `<t:${Math.floor(memberData.addedAt.getTime() / 1000)}:D>`;
      const name = message.member.displayName;

      let tierLabel = 'WS TMPV PREMIUM';
      let accentColor = 16766720;
      let headerIcon = `${E.crown}`;
      let headerTitle = `${E.crown} WS TMPV Premium Member`;
      let menuOptions = [
        { label: 'Private Lounge', value: 'perk_lounge', description: 'Your private premium text channel.', emoji: { name: '💬' } },
        { label: 'Permanent Whitelist', value: 'perk_wl', description: 'Trusted members always have access.', emoji: { name: '👥' } },
        { label: 'Room Memory', value: 'perk_memory', description: 'Settings save and restore automatically.', emoji: { name: '🧠' } },
        { label: 'Anti-Claim Shield', value: 'perk_autolock', description: 'Your room ownership stays protected.', emoji: { name: '🛡️' } },
        { label: 'Zero Cooldowns', value: 'perk_cooldown', description: 'Fast controls with no waiting.', emoji: { name: '⚡' } },
        { label: 'SafeHouse', value: 'perk_safehouse', description: 'Anti-abuse protection vs admin bypass.', emoji: { name: '🏠' } }
      ];

      const payload = {
        flags: 32768,
        message_reference: { message_id: message.id },
        components: [
          {
            type: 17,
            accent_color: accentColor,
            components: [
              {
                type: 10,
                content: `## ${headerTitle}\n\n> ${headerIcon}  **Current Tier:** \`${tierLabel}\`\n> ${E.org}  **Active Since:** ${since}\n> ⏳  **Until:** ${expiry}\n> 👥  **Circle:** \`${wlCount} trusted members\`\n\n${SEP}\n\n### 🧬 **Your Privileges**\nSelect a benefit from the menu below to explore its details.\n\n${E.arrow} *You're ruling your space, ${name}.*`
              },
              {
                type: 1,
                components: [
                  {
                    type: 3,
                    custom_id: `perks_menu_${message.author.id}`,
                    placeholder: 'Explore your privileges...',
                    options: menuOptions
                  }
                ]
              }
            ]
          }
        ]
      };

      await client.rest.post(Routes.channelMessages(message.channelId), { body: payload }).catch(() => { });

    } catch (error) {
      console.error('Error in myoffer command:', error);
    }
  }
};