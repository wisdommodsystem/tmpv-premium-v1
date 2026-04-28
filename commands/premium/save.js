const { EmbedBuilder, Routes } = require('discord.js');
const { isPremiumMember } = require('../../utils/premiumStorage');

module.exports = {
  name: 'save',
  description: 'Save your room for a given duration (WS TMPV Premium only).',
  execute: async (client, message, args, tempChannels) => {
    const sendErrorV2 = async (msg) => {
      const payload = {
        flags: 32768, // IS_COMPONENTS_V2
        message_reference: { message_id: message.id },
        components: [
          {
            type: 17, // CONTAINER
            accent_color: 15548997, // Red
            components: [
              {
                type: 10,
                content: `## 🚫 **Command Error**\n\n> ${msg}`
              }
            ]
          }
        ]
      };
      await client.rest.post(Routes.channelMessages(message.channelId), { body: payload }).catch(() => {});
    };

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        await sendErrorV2('You must be in a voice channel to use this command!');
        return;
    }

    const channelData = tempChannels.get(voiceChannel.id);
    if (!channelData) {
        await sendErrorV2('This is not a registered temporary channel!');
        return;
    }

    if (channelData.ownerId !== message.author.id) {
       await sendErrorV2('You cannot save this room because you are not the official owner!');
       return;
    }

    const isPremium = await isPremiumMember(message.author.id);
    if (!isPremium) {
        await sendErrorV2('This exclusive feature requires **WS TMPV Premium 👑**!');
        return;
    }

    const timeArg = args[0] || '1h'; // default 1 hour
    const timeMatch = timeArg.match(/^(\d+)([smh])$/);
    if (!timeMatch) {
        await sendErrorV2('Invalid time format! Try: `10m`, `1h`, `5h`');
        return;
    }
    
    let amount = parseInt(timeMatch[1]);
    const unit = timeMatch[2];
    let durationMs = 0;
    
    if (unit === 's') durationMs = amount * 1000;
    else if (unit === 'm') durationMs = amount * 60000;
    else if (unit === 'h') durationMs = amount * 3600000;

    const maxMs = 5 * 3600000; // 5 hours limit
    if (durationMs > maxMs) {
       await sendErrorV2('The maximum save duration allowed is 5 hours (`5h`)!');
       return;
    }

    channelData.savedUntil = Date.now() + durationMs;
    channelData.autoLockedForSave = false; 

    // Update settings string visually
    channelData.settings.status = `<:lock:1452014333965111398>  **SAVED for ${timeArg}**`;

    const embed = new EmbedBuilder()
      .setColor(0xF1C40F) // Premium Gold
      .setTitle('👑 **ROOM PROTECTED (WS TMPV Premium)**')
      .setDescription(`Your room's **save immunity** has been successfully activated!\nThe channel will remain protected from auto-deletion for the next \`${timeArg}\`.\n\n*Note: If you leave and the room becomes empty, it will automatically lock to preserve your space, and instantly unlock upon your return.*`)
      .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
      .setTimestamp();
      
    return message.reply({ embeds: [embed] });
  }
};
