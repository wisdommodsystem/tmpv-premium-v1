console.log('--- BOT STARTING ---');
require('dotenv').config();

// --- startup encryption backend check (no manual loading) ---
let detectedBackend = null;
try {
  require.resolve('sodium-native');
  detectedBackend = 'sodium-native';
} catch { }
if (!detectedBackend) {
  try {
    require.resolve('libsodium-wrappers');
    detectedBackend = 'libsodium-wrappers';
  } catch { }
}
if (detectedBackend) {
  console.log(`[Init] encryption backend detected: ${detectedBackend}`);
} else {
  console.error('[Init][FATAL] No sodium-compatible encryption backend installed. Voice will not work!');
}

const { Client, GatewayIntentBits, PermissionFlagsBits, ChannelType, EmbedBuilder, Routes } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');

// ── Premium Storage ────────────────────────────────────────────────────────────
const { connectDB, isPremiumMember, saveRoomSettings, getRoomSettings, getWhitelist } = require('./utils/premiumStorage');
// ──────────────────────────────────────────────────────────────────────────────
const logger = require('./utils/logger');
const { checkCooldown, checkOwnership, setVoiceStatus, safeReply } = require('./utils/helpers');
const { isBlacklisted } = require('./utils/blacklistStorage');
// ───────────────────────────────────────────────────────────────────────────

// Load admin role ID from .env
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;

// Load commands recursively
const commands = new Map();

function loadCommands(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      loadCommands(fullPath);
    } else if (file.endsWith('.js')) {
      const command = require(fullPath);
      if (command.name) {
        commands.set(command.name, command);
        if (command.aliases && Array.isArray(command.aliases)) {
          command.aliases.forEach(alias => {
            commands.set(alias, command);
          });
        }
      }
    }
  }
}

loadCommands(path.join(__dirname, 'commands'));

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// Store temporary channels with more detailed information
// Import the JSON storage utilities
const { loadChannels, saveChannels, mapToObject, objectToMap } = require('./utils/jsonStorage');

// Load channels from persistent storage (MongoDB-backed)
let tempChannelsObj = loadChannels();
let tempChannels = objectToMap(tempChannelsObj);

// Track processed interactions to prevent duplicates
const processedInteractions = new Set();

const emptySince = new Map();

// Track pending channel deletions so Cancel can actually stop them
const pendingDeletes = new Map();


// global unhandled error handlers (in case they're not already registered)
process.on('unhandledRejection', (err) => logger.error('UnhandledRejection', err));
process.on('uncaughtException', (err) => logger.error('UncaughtException', err));

// Clean up old interaction IDs every 10 minutes to prevent memory leaks
setInterval(() => {
  processedInteractions.clear();
  logger.debug('Cleared processed interactions cache');
}, 10 * 60 * 1000);

// Save channels periodically (every 5 minutes)
setInterval(() => {
  tempChannelsObj = mapToObject(tempChannels);
  saveChannels(tempChannelsObj);
  logger.info('Channels data saved to persistent storage');
}, 5 * 60 * 1000);

// ── Channel Cleanup Loop (every 30s, cache-first, no force-fetch) ──────────
setInterval(async () => {
  if (!client.isReady()) return;

  try {
    for (const [channelId] of tempChannels) {
      // Use cache first – only fetch from API if not cached
      let channel = client.channels.cache.get(channelId);
      if (!channel) {
        channel = await client.channels.fetch(channelId).catch(() => null);
      }

      if (!channel || channel.type !== ChannelType.GuildVoice) {
        tempChannels.delete(channelId);
        emptySince.delete(channelId);
        continue;
      }

      const membersCount = channel.members?.size ?? 0;

      if (membersCount === 0) {
        const cd = tempChannels.get(channelId);
        // Check if room is saved (Platinum Offer)
        if (cd && cd.savedUntil && cd.savedUntil > Date.now()) {
           // Provide Immunity
           if (!cd.autoLockedForSave) {
              cd.autoLockedForSave = true;
              if (process.env.TEMP_ROOM_ROLE_ID) {
                  channel.permissionOverwrites.edit(process.env.TEMP_ROOM_ROLE_ID, { Connect: false }).catch(()=>{});
                  logger.info(`Auto-locked saved channel for ${cd.ownerId}`);
              }
           }
        } else {
           const t = emptySince.get(channelId) || Date.now();
           if (Date.now() - t >= 10000) { // 10-second grace period
             await channel.delete().catch(() => { });
             if (cd && cd.textChannelId) {
                const tc = client.channels.cache.get(cd.textChannelId);
                if (tc) await tc.delete().catch(() => {});
             }
             tempChannels.delete(channelId);
             emptySince.delete(channelId);
             logger.info(`Auto-deleted empty temp channel: ${channelId}`);
           } else {
             emptySince.set(channelId, t);
           }
        }
      } else {
        emptySince.delete(channelId);
      }
    }
  } catch (e) {
    logger.error('Error in cleanup loop', e);
  }
}, 30000);
// ───────────────────────────────────────────────────────────────────────────

// Save channels on process exit
process.on('SIGINT', () => {
  tempChannelsObj = mapToObject(tempChannels);
  saveChannels(tempChannelsObj);
  console.log('Channels data saved to persistent storage before exit');
  process.exit();
});

const commandPrefix = '.v';

// Store the bot's voice connection to Create Room
// track create-room voice connections per guild to avoid races
const createRoomConnections = new Map();

// Function to count total users in temporary channels (excluding bots)
function getTotalUsersInTempChannels(guild) {
  let totalUsers = 0;

  tempChannels.forEach((channelData, channelId) => {
    const channel = guild.channels.cache.get(channelId);
    if (channel && channel.type === ChannelType.GuildVoice) {
      // Count only real users, not bots
      const realUsers = channel.members.filter(member => !member.user.bot);
      totalUsers += realUsers.size;
    }
  });

  return totalUsers;
}

// ── Connect bot to Create Room (with retry limit) ──────────────────────────────
const MAX_RECONNECT_RETRIES = 5;

async function connectToCreateRoom(guild, retryCount = 0) {
  if (retryCount >= MAX_RECONNECT_RETRIES) {
    logger.warn(`Max reconnect retries (${MAX_RECONNECT_RETRIES}) reached for guild: ${guild.name}. Stopping.`);
    return;
  }

  try {
    const createRoomId = process.env.CREATE_ROOM_ID;
    const createRoomChannel = guild.channels.cache.find(
      ch => (ch.id === createRoomId || ch.name.includes('Create Room') || ch.name.startsWith('➕') || ch.name.toLowerCase().includes('create'))
        && ch.type === ChannelType.GuildVoice
    );

    if (!createRoomChannel) {
      logger.warn(`Create Room channel not found in guild: ${guild.name}`);
      return;
    }

    // if we already have a connection for this guild that's still active, skip
    const existing = createRoomConnections.get(guild.id);
    if (existing) {
      const state = existing.state;
      if (state !== VoiceConnectionStatus.Destroyed && state !== VoiceConnectionStatus.Disconnected) {
        logger.debug(`Existing create-room connection active for ${guild.name}, skipping new one.`);
        return;
      }
      // previous connection is no longer usable, clean up
      try { existing.destroy(); } catch (_) { }
      createRoomConnections.delete(guild.id);
    }

    const connection = joinVoiceChannel({
      channelId: createRoomChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });
    // store for the guild
    createRoomConnections.set(guild.id, connection);

    connection.on(VoiceConnectionStatus.Ready, () => {
      logger.success(`Connected to Create Room: "${createRoomChannel.name}" in ${guild.name}`);
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      logger.warn(`Disconnected from Create Room in ${guild.name}. Retry ${retryCount + 1}/${MAX_RECONNECT_RETRIES}...`);
      // remove from map before retrying
      createRoomConnections.delete(guild.id);
      setTimeout(() => connectToCreateRoom(guild, retryCount + 1), 5000);
    });

    connection.on('error', (err) => {
      logger.error('Voice connection error (createRoom)', err);
    });

  } catch (error) {
    logger.error('Error connecting to Create Room', error);
  }
}
// ───────────────────────────────────────────────────────────────────────────



// Update the command aliases system
const commandAliases = {
  'l': 'lock',
  'ul': 'unlock',
  'cl': 'claim',
  'o': 'owner',
  'vc': 'vcinfo',
  'sb': 'sb-on',
  'sbof': 'sb-off',
  'st': 'status',
  'tr': 'transfer',
  'p': 'permit-role',
  'r': 'reject-role',
  's': 'save',
  'm': 'mute',
  'u': 'unmute',
  'onst': 'cam-on',
  'offst': 'cam-off',
  'n': 'name',
  'ur': 'unreject',
  'k': 'kick'
};

// Add more specific aliases as needed

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Check if message starts with commandPrefix
  if (!message.content.startsWith(commandPrefix)) return;

  const args = message.content.slice(commandPrefix.length).trim().split(/ +/);
  const commandInput = args.shift().toLowerCase();

  // Check if it's an alias and convert to full command name
  const commandName = commandAliases[commandInput] || commandInput;

  if (!commands.has(commandName)) return; // unknown command - silently ignore

  // ── Smart Cooldown check ──────────────────────────────────────────────────
  // ⚡ Diamond (Offer 3) members bypass ALL cooldowns
  const { isPremiumMember: checkPremium } = require('./utils/premiumStorage');
  const senderPremium = await checkPremium(message.author.id);
  const isDiamondUser = !!senderPremium;

  if (!isDiamondUser) {
    const commandCooldowns = {
      'name': 300,   // 5 minutes (Discord limit)
      'limit': 60,   // 1 minute
      'lock': 10,
      'unlock': 10,
      'hide': 10,
      'unhide': 10,
      'bot-join': 5,
      'bot-leave': 5
    };

    const cooldownTime = commandCooldowns[commandName] || 3;
    const { onCooldown, remaining } = checkCooldown(message.author.id, commandName, cooldownTime);

    if (onCooldown) {
      return safeReply(message, {
        embeds: [
          new EmbedBuilder()
            .setColor(0x2B2D31)
            .setDescription(`> ⏳ **Please wait \`${remaining}s\` before using \`.v ${commandName}\` again.**`)
            .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        ]
      });
    }
  }
  // ─────────────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────

  const command = commands.get(commandName);
  try {
    logger.info(`[CMD] ${message.author.tag} → ${commandName}`);

    // List of commands that don't need voice channel verification
    const setupCommands = [
      'wissetup', 'help', 'blacklist', 'rblacklist', 'bhelp', 'blist', 'premium', 
      'offershelp', 'plist', 'clearpremium', 'whitelist', 'unwhitelist', 'myoffer', 
      'whitelistlista', 'whitelistlist', 'vping', 'top', 'add', 'remove', 
      'botjoin', 'botleave', 'wishelp', 'manhelp', 'tmpvrules', 'apollo', 'list', 'bl', 'wl', 'modhelp', 'phelp'
    ];

    // List of commands that don't need owner verification
    const nonOwnerCommands = ['claim', 'owner', 'vcinfo'];

    // List of commands that require admin role
    const adminCommands = ['permit-role', 'reject-role', 'vcinfo', 'sb-off', 'sb-on', 'blacklist', 'rblacklist', 'bhelp', 'blist', 'premium', 'offershelp', 'plist', 'clearpremium'];

    // Check if command requires admin role
    if (adminCommands.includes(commandName)) {
      // Check if user has the admin role
      if (!message.member.roles.cache.has(ADMIN_ROLE_ID)) {
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
    }

    if (!setupCommands.includes(commandName)) {
      // Check if user is in a voice channel for regular commands only
      if (!message.member.voice.channel) {
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
                  content: `## ❌ **Voice Required**\n\n> You must be in a voice channel to use this command!`
                }
              ]
            }
          ]
        };
        await client.rest.post(Routes.channelMessages(message.channelId), { body: errorV2 }).catch(() => {});
        return;
      }

      const voiceChannel = message.member.voice.channel;
      const channelData = tempChannels.get(voiceChannel.id);

      if (!channelData) {
        const errorV2 = {
          flags: 32768, // IS_COMPONENTS_V2
          message_reference: { message_id: message.id },
          components: [
            {
              type: 17, // CONTAINER
              accent_color: 16753920, // Orange
              components: [
                {
                  type: 10,
                  content: `## ⚠️ **Warning**\n\n> This is not a designated temporary channel!`
                }
              ]
            }
          ]
        };
        await client.rest.post(Routes.channelMessages(message.channelId), { body: errorV2 }).catch(() => {});
        return;
      }

      // Check if the user is the owner of the channel (except for nonOwnerCommands)
      if (!nonOwnerCommands.includes(commandName) && channelData.ownerId !== message.author.id) {
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
                  content: `## 🚫 **Access Denied**\n\n> You are not the official owner of this channel!`
                }
              ]
            }
          ]
        };
        await client.rest.post(Routes.channelMessages(message.channelId), { body: errorV2 }).catch(() => {});
        return;
      }
    }

    await command.execute(client, message, args, tempChannels);
  } catch (error) {
    logger.error(`Command error [${commandName}]`, error);
    message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2B2D31)
          .setTitle('❌ Error')
          .setDescription('An error occurred while executing the command.')
          .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
          .setTimestamp()
      ]
    }).catch(() => { });
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  // Check if the user joined a temporary voice channel
  if (newState.channel && tempChannels.has(newState.channel.id)) {
    try {
      const channelData = tempChannels.get(newState.channel.id);
      const isOwner = channelData.ownerId === newState.member.id;

      // Pre-calculate allowlists for SafeHouse and permission sync logic
      const isAllowed = channelData.allowedUsers && channelData.allowedUsers.includes(newState.member.id);
      const ownerWhitelist = await getWhitelist(channelData.ownerId);
      const isWhitelisted = ownerWhitelist && ownerWhitelist.includes(newState.member.id);

      // SafeHouse Anti-Abuse: block admin-level users ONLY when they bypass a full limit
      // and are NOT explicitly allowed by owner invite/whitelist.
      if (channelData?.safeHouseEnabled && !isOwner && !isAllowed && !isWhitelisted) {
        const isLimitedRoom = (newState.channel.userLimit || 0) > 0;
        if (!isLimitedRoom) {
          // SafeHouse enforcement is disabled for unlimited rooms by design
        } else {
        const hasExceededLimit = newState.channel.members.size > newState.channel.userLimit;
        if (!hasExceededLimit) {
          // If limit is not exceeded, allow join normally even for admins
        } else {
        const hasAdminPerm = newState.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasAdminRole = ADMIN_ROLE_ID ? newState.member.roles.cache.has(ADMIN_ROLE_ID) : false;
        const isAdminLevelUser = hasAdminPerm || hasAdminRole;

        if (isAdminLevelUser) {
          const protectedChannelName = newState.channel?.name || 'this protected room';
          await newState.disconnect().catch(() => {});

          await newState.member.send({
            content: `🚫 TMPV Anti-Abuse: You were removed from "${protectedChannelName}" because this limited room is protected by SafeHouse.`
          }).catch(() => {});

          logger.warn(`[SafeHouse] Blocked admin-level join by ${newState.member.user.tag} in ${protectedChannelName}`);
          return;
        }
        }
        }
      }

      if (channelData && Array.isArray(channelData.rejectedUsers) && channelData.rejectedUsers.includes(newState.member.id)) {
        await newState.channel.permissionOverwrites.edit(newState.member.id, { Connect: false });
        const toxicChannelId = process.env.TOXIC;
        if (toxicChannelId) {
          const toxicChannel = newState.guild.channels.cache.get(toxicChannelId);
          if (toxicChannel && newState.member?.voice?.channel) {
            try { await newState.member.voice.setChannel(toxicChannel); } catch { }
          }
        }
        return;
      }
      // Get current temp room role permissions to apply to the user
      // Skip if user is owner or invited/allowed
      if (isWhitelisted) logger.info(`[Whitelist] Recognized ${newState.member.user.displayName} as whitelisted member for channel owner ${channelData.ownerId}`);

      // Check if they ALREADY have a specific member overwrite that allows Connect (safeguard)
      const existingOverwrite = newState.channel.permissionOverwrites.cache.get(newState.member.id);
      const hasSpecificAllow = existingOverwrite && existingOverwrite.allow.has(PermissionFlagsBits.Connect);

      if (process.env.TEMP_ROOM_ROLE_ID && !isOwner && !isAllowed && !isWhitelisted && !hasSpecificAllow) {
        const tempRole = newState.guild.roles.cache.get(process.env.TEMP_ROOM_ROLE_ID);
        if (tempRole) {
          // Get the current role permissions from the channel
          const rolePermissions = newState.channel.permissionOverwrites.cache.get(process.env.TEMP_ROOM_ROLE_ID);

          if (rolePermissions) {
            // Apply the same permissions to the individual user
            const userPermissions = {};

            // Copy allow permissions
            if (rolePermissions.allow) {
              rolePermissions.allow.toArray().forEach(permission => {
                userPermissions[permission] = true;
              });
            }

            // Copy deny permissions
            if (rolePermissions.deny) {
              rolePermissions.deny.toArray().forEach(permission => {
                userPermissions[permission] = false;
              });
            }

            // Apply permissions to the user
            await newState.channel.permissionOverwrites.edit(newState.member.id, userPermissions);
            logger.info(`Applied permissions to ${newState.member.user.displayName} in ${newState.channel.name}`);
          }
        }
      }

      if (channelData.textChannelId && !isOwner) {
        const txtChan = newState.guild.channels.cache.get(channelData.textChannelId);
        if (txtChan) {
            // Allow Whitelisted users or explicitly invited users
            if (isAllowed || isWhitelisted) {
                const sendPerm = channelData.chatLocked ? false : true;
                await txtChan.permissionOverwrites.edit(newState.member.id, {
                    ViewChannel: true,
                    SendMessages: sendPerm,
                    ReadMessageHistory: true
                }).catch(() => {});
            } else if (process.env.TEMP_ROOM_ROLE_ID) {
                // For non-whitelisted/non-invited users, follow role sync rules if needed
                // (Existing logic usually ignores them until invited)
            }
        }
      }

      // ── Notify ONLY the channel owner in TEMP-HELP (not every member who joins) ──
      const isChannelOwner = channelData.ownerId === newState.member.id;
      if (isChannelOwner) {
        // Clear leave timestamp if owner returns
        delete channelData.ownerLeftAt;

        // Unlock if it was auto-locked via Platinum save
        if (channelData.autoLockedForSave) {
           channelData.autoLockedForSave = false;
           if (process.env.TEMP_ROOM_ROLE_ID) {
               await newState.channel.permissionOverwrites.edit(process.env.TEMP_ROOM_ROLE_ID, { Connect: true }).catch(() => {});
           }
           logger.info(`Owner returned. Auto-unlocked saved temp channel: ${newState.channel.id}`);
        }

        const tempHelpChannel = newState.guild.channels.cache.find(
          ch => ch.name === 'TEMP-HELP' && ch.type === ChannelType.GuildText
        );
        if (tempHelpChannel) {
          const msg = await tempHelpChannel.send({
            content: `<@${newState.member.id}> Your temp channel is ready! Use \`.v help\` or \`.v panel\` to manage it.`
          }).catch(() => null);
          // Auto-delete after 2 minutes to keep the channel clean
          if (msg) setTimeout(() => msg.delete().catch(() => { }), 2 * 60 * 1000);
        }
      }
      // ─────────────────────────────────────────────────────────────────────────────

    } catch (error) {
      logger.error('voiceStateUpdate (join) error', error);
    }
  }

  // Check if the user left a temporary voice channel (actual leave or move away)
  if (
    oldState.channel &&
    tempChannels.has(oldState.channel.id) &&
    oldState.channelId !== newState.channelId // ensure not a state change within the same channel
  ) {
    try {
      const channelData = tempChannels.get(oldState.channel.id);
      if (channelData) {
        if (oldState.member.id === channelData.ownerId) {
          // Track when the owner left
          channelData.ownerLeftAt = Date.now();
          logger.info(`Owner ${oldState.member.user.displayName} left their channel ${oldState.channel.name}. Claim timer started.`);
        } else {
          // ── FIX: Don't remove permissions if user is in allowedUsers or persistent Whitelist ──
          const isAllowed = channelData.allowedUsers && channelData.allowedUsers.includes(oldState.member.id);
          const ownerWhitelist = await getWhitelist(channelData.ownerId);
          const isWhitelisted = ownerWhitelist && ownerWhitelist.includes(oldState.member.id);

          // Voice Access: Protect persistent Whitelist and Allowed users
          if (!isAllowed && !isWhitelisted) {
            const userPermissionOverwrite = oldState.channel.permissionOverwrites.cache.get(oldState.member.id);
            if (userPermissionOverwrite) {
              await userPermissionOverwrite.delete();
              logger.info(`Removed voice permissions for ${oldState.member.user.displayName} who left ${oldState.channel.name}`);
            }
          }

          // Text Access: Remove for EVERYONE except owner when they leave (including whitelist/allowed)
          if (channelData.textChannelId) {
            const txtChan = oldState.guild.channels.cache.get(channelData.textChannelId);
            if (txtChan) {
              const txtPerm = txtChan.permissionOverwrites.cache.get(oldState.member.id);
              if (txtPerm) {
                 await txtPerm.delete().catch(() => {});
                 logger.info(`Removed text access for ${oldState.member.user.displayName} from ${txtChan.name}`);
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error cleaning up permissions on leave', error);
    }
  }

  // Check if the user joined the "➕│Create Room" channel (by ID or hardcoded name)
  const createRoomId = process.env.CREATE_ROOM_ID;
  if (newState.channel && (newState.channel.id === createRoomId || newState.channel.name === '➕│Create Room')) {
    // ── Check Global Blacklist ──
    const blacklistEntry = isBlacklisted(newState.member.id);
    if (blacklistEntry) {
      try {
        await newState.disconnect().catch(() => { });
        const dmEmbed = new EmbedBuilder()
          .setTitle('🚫 **Access Denied**')
          .setColor(0xE74C3C)
          .setDescription(`> **Hello <@${newState.member.id}>,**\nYou are blacklisted from creating temporary voice channels.\n\n**Reason:** \`${blacklistEntry.reason}\`\n**Expires:** \`${blacklistEntry.expiresAt ? new Date(blacklistEntry.expiresAt).toLocaleString() : 'Permanent'}\``)
          .setFooter({ text: 'Wisdom Security System' });

        await newState.member.send({ embeds: [dmEmbed] }).catch(() => { });
      } catch (e) { }
      return;
    }
    try {
      // Create permission overwrites array
      const permissionOverwrites = [
        {
          id: newState.guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: newState.member.id,
          allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.ViewChannel],
        }
      ];

      // Add temp room role permissions if the role exists
      if (process.env.TEMP_ROOM_ROLE_ID) {
        const tempRole = newState.guild.roles.cache.get(process.env.TEMP_ROOM_ROLE_ID);
        if (tempRole) {
          permissionOverwrites.push({
            id: process.env.TEMP_ROOM_ROLE_ID,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.UseVAD,
              PermissionFlagsBits.Stream
            ],
          });
        }
      }

      // Check if user is premium and apply saved settings
      const isPremium = await isPremiumMember(newState.member.id);
      let savedSettings = null;
      let channelName = `🎧｜${newState.member.user.displayName}'s Vc`;
      let userLimit = null;

      if (isPremium) {
        // --- PERSISTENT WHITELIST (Offer 1+) ---
        if (isPremium) {
           const myWhitelist = await getWhitelist(newState.member.id);
           if (Array.isArray(myWhitelist)) {
             for (const id of myWhitelist) {
                if (id && typeof id === 'string') {
                  try {
                    // Ensure the member is cached before adding permissions
                    await newState.guild.members.fetch(id);
                    permissionOverwrites.push({
                       id: id,
                       allow: [
                          PermissionFlagsBits.Connect, 
                          PermissionFlagsBits.ViewChannel,
                          PermissionFlagsBits.Speak,
                          PermissionFlagsBits.UseVAD,
                          PermissionFlagsBits.SendMessages,
                          PermissionFlagsBits.ReadMessageHistory
                       ]
                    });
                  } catch (e) {
                    // User left the server or invalid ID, skip silently
                  }
                }
             }
           }
           logger.info(`Applied persistent whitelist for ${newState.member.user.displayName}`);
        }
        // ----------------------------------------
        
        savedSettings = await getRoomSettings(newState.member.id);
        if (savedSettings) {
          channelName = savedSettings.name || channelName;
          userLimit = savedSettings.userLimit || null;
          logger.info(`Applying saved settings for premium user ${newState.member.user.displayName}`);
        }

        // --- DIAMOND (Offer 3): Palace name ALWAYS overrides saved settings ---
        if (isPremium) {
          channelName = `💎｜${newState.member.user.displayName}'s Palace`;
        }
      }

      // Create a new temporary voice channel for the user
      const tempChannel = await newState.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: newState.channel.parent,
        permissionOverwrites: permissionOverwrites,
        userLimit: userLimit
      });

      // Move the user to the new temporary channel
      await newState.setChannel(tempChannel);

      let currentTextChannelId = null;
      let isGoldOffer = false;

      if (isPremium) {
        isGoldOffer = true;
        try {
          const textCategory = process.env.VIP_TEXT_CATEGORY_ID || tempChannel.parentId;
          
          const textOverwrites = [
            {
              id: newState.guild.id,
              deny: [PermissionFlagsBits.ViewChannel]
            },
            {
              id: newState.member.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
            }
          ];

          const textChannel = await newState.guild.channels.create({
            name: `🎧｜${newState.member.user.displayName}・chat`,
            type: ChannelType.GuildText,
            parent: textCategory,
            permissionOverwrites: textOverwrites
          });
          currentTextChannelId = textChannel.id;

          let loungeTitle = '**WS TMPV Premium Lounge** 👑';
          let loungeColor = 16766720;

          const premiumPayload = {
            flags: 32768, // IS_COMPONENTS_V2
            components: [
              {
                type: 17, // CONTAINER
                accent_color: loungeColor,
                components: [
                  {
                    type: 12, // IMAGE
                    items: [{ media: { url: "https://i.postimg.cc/3R5hgh1W/download.gif" } }]
                  },
                  {
                    type: 10,
                    content: `## <a:12104crownpink:1449139449211387945> ${loungeTitle}\n\n**Welcome, <@${newState.member.id}>! ✨**\nYour private text channel has been successfully established. As a premium member, you hold full administrative control over this space, ensuring a seamless and secure environment for you and your guests.\n\n<a:boost:1449497847094444083> **Thank you for your incredible support. Enjoy your premium experience!**`
                  },
                  {
                    type: 14 // SEPARATOR
                  },
                  {
                    type: 9, 
                    components: [{ type: 10, content: "**🔒 Chat Access: Unlocked**\nClick here to restrict writing access to yourself." }],
                    accessory: {
                      type: 2,
                      style: 2,
                      label: "Lock chat",
                      custom_id: "lock_chat",
                      emoji: { name: "🔒" }
                    }
                  }
                ]
              }
            ]
          };

          await client.rest.post(Routes.channelMessages(textChannel.id), { body: premiumPayload });
        } catch (err) {
          console.error("Error creating premium text channel:", err);
        }
      }

      // Store the temporary channel information
      const channelData = {
        ownerId: newState.member.id,
        textChannelId: currentTextChannelId,
        chatLocked: false,
        settings: {
          status: '**.v help/panel**  <a:FZ_red_cross:1360451122807963770>'
        },
        isPremium: isPremium
      };

      // Apply additional saved settings if premium
      if (isPremium && savedSettings) {
        if (savedSettings.locked) {
          // Apply lock if saved
          try {
            if (process.env.TEMP_ROOM_ROLE_ID) {
              await tempChannel.permissionOverwrites.edit(process.env.TEMP_ROOM_ROLE_ID, {
                Connect: false
              });
              channelData.settings.status = '<:lock:1452014333965111398>  ** Room Masdoda**';
            }
          } catch (e) {
            logger.error('Error applying saved lock setting:', e);
          }
        }

        if (savedSettings.hidden) {
          // Apply hide if saved
          try {
            if (process.env.TEMP_ROOM_ROLE_ID) {
              await tempChannel.permissionOverwrites.edit(process.env.TEMP_ROOM_ROLE_ID, {
                ViewChannel: false
              });
            }
          } catch (e) {
            logger.error('Error applying saved hide setting:', e);
          }
        }
      }

      tempChannels.set(tempChannel.id, channelData);

      // Set default status for the new temporary channel
      try {
        // Diamond members get a special status
        const isDiamond = !!isPremium;
        const defaultStatus = isDiamond
          ? '**Diamond Vc** <a:color_yellow_diamante:1449454950022119427>'
          : '**.v help/panel**  <a:FZ_red_cross:1360451122807963770>';
        const response = await fetch(`https://discord.com/api/v10/channels/${tempChannel.id}/voice-status`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bot ${client.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            status: defaultStatus
          })
        });

        if (response.ok) {
          console.log(`✅ Default status set for new temp channel: ${tempChannel.name}`);
        } else {
          console.error('Failed to set default status:', response.status);
        }
      } catch (error) {
        console.error('Error setting default status:', error);
      }

      // ── Welcome Message (Dynamic Layout Components V2) ─────────────────────────
      const arrow = '<a:wisdoarrow:1453486894779338885>';
      const crown = '<a:12104crownpink:1449139449211387945>';
      const boost = '<a:boost:1449497847094444083>';
      
      let isDiamondOffer = false;
      let welcomeTitle = "🎉 **Welcome to Your Temporary Room!**";
      let welcomeAccent = 2829617; // Default Dark Gray
      let commandList = `${arrow} **Lock:** \`.v lock\`\n${arrow} **Rename:** \`.v name <text>\`\n${arrow} **Limit:** \`.v limit <num>\``;
      let exclusiveNote = "✦ ・ Use the full control panel for more options.";
      
      if (isPremium) {
        isDiamondOffer = true;
        welcomeTitle = `${crown} **WS TMPV Premium Palace** 🏛️`;
        welcomeAccent = 16766720;
        commandList = `${boost} **Lock/Hide:** Total Privacy Control\n${boost} **Admin:** \`.v wl / .v permit\`\n${boost} **Power:** \`.v save / .v rename\`\n${boost} **Premium Perk:** \`All features active ⚡\``;
        exclusiveNote = "👑 ・ Welcome, Premium Member. Your palace is ready.";
      }

      const welcomePayload = {
        flags: 32768, // IS_COMPONENTS_V2
        components: [
          {
            type: 17, // CONTAINER
            accent_color: welcomeAccent,
            components: [
              {
                type: 10, // Header
                content: `## ${welcomeTitle}`
              },
              {
                type: 12, // IMAGE (GIF)
                items: [{ media: { url: isPremium ? "https://i.postimg.cc/3R5hgh1W/download.gif" : "https://i.postimg.cc/gkY14NCL/image.png" } }]
              },
              {
                type: 14 // SEPARATOR
              },
              {
                type: 10, // Content Description
                content: `### 👋 **Hello <@${newState.member.id}>!**\nYour private space has been successfully established.\n\n**<a:notif:1447321335117123610> Available Controls:**\n${commandList}`
              },
              {
                type: 14 // SEPARATOR
              },
              {
                type: 9, // SECTION with Accessory Button
                components: [{ type: 10, content: exclusiveNote }],
                accessory: {
                  type: 2,
                  style: isPremium ? 3 : 2, // Success (Green) for Premium, Gray for Regular
                  label: "Control Panel",
                  custom_id: "open_panel",
                  emoji: { name: "🎛️" }
                }
              },
              {
                type: 14 // SEPARATOR
              },
              {
                type: 10, // FOOTER
                content: "Wisdom Premium Systems 📩 | “Quality means doing it right when no one is looking.”"
              }
            ]
          }
        ]
      };

      // Send the advanced V2 layout message (skip for Offer3)
      if (!isDiamondOffer) {
        try {
          await client.rest.post(Routes.channelMessages(tempChannel.id), { body: welcomePayload });
        } catch (welcomeErr) {
          console.error('Error sending V2 welcome message:', welcomeErr);
          // Fallback to standard embed if V2 fails
          await tempChannel.send({
            content: `Welcome <@${newState.member.id}>! Your channel is ready. Use \`.v help\` for commands.`
          });
        }
      }

      // Offer3 exclusive announcement inside the voice-channel chat
      if (isDiamondOffer) {
        const diamondOfferPayload = {
          flags: 32768, // IS_COMPONENTS_V2
          components: [
            {
              type: 17, // CONTAINER
              accent_color: 16766720, // Gold styling as requested
              components: [
                {
                  type: 12, // Luxury banner
                  items: [{ media: { url: "https://i.postimg.cc/JhBHMDvp/download.gif" } }]
                },
                {
                  type: 10,
                  content: `## <a:12104crownpink:1449139449211387945> **Diamond Offer III Active**\n\nWelcome <@${newState.member.id}>.\n✅ Your private text channel has been created successfully.`
                },
                {
                  type: 14 // SEPARATOR
                },
                {
                  type: 10,
                  content: `### 💠 Perks\n${arrow} Zero Cooldowns\n${arrow} Palace Name\n${arrow} Anti-Claim Shield`
                },
                {
                  type: 14 // SEPARATOR
                },
                {
                  type: 10,
                  content: `### 🧭 Quick Commands\n${boost} \`.v panel\`\n${boost} \`.v myoffer\`\n${boost} \`.v whitelist @user\``
                },
                {
                  type: 14 // SEPARATOR
                },
                {
                  type: 9, // SECTION + button
                  components: [{ type: 10, content: `✨ **Luxury Control Console ready.**\nUse the button to open your panel instantly.` }],
                  accessory: {
                    type: 2,
                    style: 2,
                    label: "Open Diamond Panel",
                    custom_id: "open_panel",
                    emoji: { name: "👑" }
                  }
                },
                {
                  type: 14 // SEPARATOR
                },
                {
                  type: 10,
                  content: `👑 Tip: Use \`.v panel\` for full control.`
                }
              ]
            }
          ]
        };

        await client.rest.post(Routes.channelMessages(tempChannel.id), { body: diamondOfferPayload }).catch((err) => {
          console.error('Error sending Offer3 announcement:', err);
        });
      }

    } catch (error) {
      console.error('Error creating temporary channel:', error);
    }
  }


}); // End of voiceStateUpdate event handler

// Handle button interactions and select menus
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

  // Add error handling wrapper
  try {
    // Check if interaction is already replied to or deferred
    if (interaction.replied || interaction.deferred) return;

    // Check if this interaction has already been processed
    if (processedInteractions.has(interaction.id)) return;
    processedInteractions.add(interaction.id);

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

    // ── Smart Cooldown for Buttons ───────────────────────────────────────────
    if (interaction.isButton() && (interaction.customId.startsWith('panel_') || interaction.customId.startsWith('channel_'))) {
      const actionMap = {
        'rename': 300,
        'limit': 60,
        'lock': 10,
        'unlock': 10,
        'hide': 10,
        'unhide': 10
      };

      const action = interaction.customId.split('_')[1]; // e.g., 'lock' from 'panel_lock'
      const cooldownTime = actionMap[action] || 3;
      const { onCooldown, remaining } = checkCooldown(interaction.user.id, interaction.customId, cooldownTime);

      if (onCooldown) {
        return interaction.reply({
          content: `> ⏳ **Please wait \`${remaining}s\` before using this action again.**`,
          ephemeral: true
        });
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (interaction.customId === 'lock_chat' || interaction.customId === 'unlock_chat') {
       const txtChan = interaction.channel;
       let foundCd = null;
       let voiceChanId = null;
       for (const [vId, cd] of tempChannels.entries()) {
          if (cd.textChannelId === txtChan.id) {
             foundCd = cd;
             voiceChanId = vId;
          }
       }
       if (!foundCd) return interaction.reply({ content: '❌ **Error:** The attached voice channel no longer exists!', ephemeral: true });
       if (foundCd.ownerId !== interaction.user.id) return interaction.reply({ content: '❌ **Access Denied:** You do not have permission to manage this chat!', ephemeral: true });

       const isLocking = interaction.customId === 'lock_chat';
       foundCd.chatLocked = isLocking;
       
       const voiceChan = interaction.guild.channels.cache.get(voiceChanId);
       let membersToLock = [];
       if (voiceChan) {
          for (const [memId, mem] of voiceChan.members) {
             if (memId !== foundCd.ownerId && memId !== client.user.id) membersToLock.push(memId);
          }
       }
       for (let memId of membersToLock) {
         await txtChan.permissionOverwrites.edit(memId, { SendMessages: !isLocking }).catch(() => {});
       }

       let loungeTitle = '**WS TMPV Premium Lounge** 👑';
       let loungeColor = 16766720;

       const premiumPayload = {
            flags: 32768, // IS_COMPONENTS_V2
            components: [
              {
                type: 17, // CONTAINER
                accent_color: loungeColor,
                components: [
                  {
                    type: 12, // IMAGE
                    items: [{ media: { url: "https://i.postimg.cc/3R5hgh1W/download.gif" } }]
                  },
                  {
                    type: 10,
                    content: `## <a:12104crownpink:1449139449211387945> ${loungeTitle}\n\n**Welcome, <@${foundCd.ownerId}>! ✨**\nYour private text channel has been successfully established. As a premium member, you hold full administrative control over this space, ensuring a seamless and secure environment for you and your guests.\n\n<a:boost:1449497847094444083> **Thank you for your incredible support. Enjoy your premium experience!**`
                  },
                  {
                    type: 14 // SEPARATOR
                  },
                  {
                    type: 9, 
                    components: [{ type: 10, content: isLocking ? "**🔓 Chat Access: Locked**\nClick here to restore writing access." : "**🔒 Chat Access: Unlocked**\nClick here to restrict writing access to yourself." }],
                    accessory: {
                      type: 2,
                      style: isLocking ? 3 : 2,
                      label: isLocking ? "Unlock chat" : "Lock chat",
                      custom_id: isLocking ? "unlock_chat" : "lock_chat",
                      emoji: { name: isLocking ? "🔓" : "🔒" }
                    }
                  }
                ]
              }
            ]
          };

       await client.rest.patch(Routes.channelMessage(txtChan.id, interaction.message.id), { body: premiumPayload }).catch(()=>{});
       return interaction.reply({ content: isLocking ? '✅ **Chat Locked:** Messaging restricted to owner.' : '✅ **Chat Unlocked:** Messaging restored for everyone.', ephemeral: true });
    }

    if (interaction.customId.startsWith('premium_details_')) {
      const targetId = interaction.customId.replace('premium_details_', '');
      if (interaction.user.id !== targetId) return interaction.reply({ content: '❌ **Access Denied:** Only the owner of this profile can view its details.', ephemeral: true });

      const { getPremiumMember, getWhitelist } = require('./utils/premiumStorage');
      const memberData = await getPremiumMember(targetId);
      if (!memberData) return interaction.reply({ content: '❌ **Error:** No premium data found for your account.', ephemeral: true });

      const whitelist = await getWhitelist(targetId);
      const whitelistCount = whitelist ? whitelist.length : 0;
      
      const offerType = 'WS TMPV PREMIUM';
      let benefits = '• Permanent Room Saver\n• Whitelist Access\n• Custom Panel Controls\n• Anti-Claim Shield\n• Zero Cooldowns\n• Premium Room Priority';
      
      const detailsPayload = {
        flags: 32768 | 64, // IS_COMPONENTS_V2 | EPHEMERAL
        components: [
          {
            type: 17, // CONTAINER
            accent_color: 3447003, // Diamond Blue
            components: [
              {
                  type: 10,
                  content: `## 📊 **Detailed Subscription Report**\n\n> Hello <@${targetId}>, here is the full breakdown of your premium status.\n\n**⭐ CURRENT TIER:** \`${offerType}\`\n**👥 WHITELISTED:** \`${whitelistCount} Users\`\n**📅 ACTIVATED:** <t:${Math.floor(memberData.addedAt.getTime() / 1000)}:f>\n\n**🎉 ACTIVE BENEFITS:**\n\`\`\`${benefits}\`\`\``
              }
            ]
          }
        ]
      };

      return interaction.reply(detailsPayload);
    }

    if (interaction.customId.startsWith('perks_menu_')) {
      const targetId = interaction.customId.split('_')[2];
      if (interaction.user.id !== targetId) return interaction.reply({ content: '❌ **Access Denied:** Only the owner of this profile can explore these perks.', ephemeral: true });

      const perk = interaction.values[0];
      let title = '';
      let info = '';

      switch (perk) {
        case 'perk_lounge':
          title = '💬 Private Text Lounge';
          info = '> A restricted text channel created exclusively for you and your whitelisted friends. It appears when you join your room and vanishes when you leave, ensuring total privacy for your conversations.';
          break;
        case 'perk_wl':
          title = '👥 Permanent Whitelist';
          info = '> Your trusted inner circle. Any user in this list can bypass your room locks and access your private lounges automatically. It persists forever in the database.';
          break;
        case 'perk_memory':
          title = '🧠 Room Memory';
          info = '> Your setup is immortal. The bot remembers your custom room name and user limit, restoring them automatically every time you join the "Create Room" channel.';
          break;
        case 'perk_autolock':
          title = '🛡️ Anti-Claim Shield';
          info = '> Your room ownership is protected. If you are the official owner, other users cannot steal your room using `.v claim`.';
          break;
        case 'perk_cooldown':
          title = '⚡ Zero Cooldowns';
          info = '> Premium speed. You get faster control flow and priority access to premium actions (panel, top, save, etc.).';
          break;
        case 'perk_safehouse':
          title = '🏠 SafeHouse (TMPV Anti-Abuse)';
          info = '> A premium protection mode you can toggle using `.v safehouse` / `.v sh`.\n> When enabled, admins cannot bypass your room limit. If an admin joins by exceeding the limit, they are removed instantly and warned in DM.';
          break;
      }

      const perkPayload = {
        flags: 32768 | 64, // IS_COMPONENTS_V2 | EPHEMERAL
        components: [
          {
            type: 17,
            accent_color: 3447003,
            components: [
              {
                type: 10,
                content: `## ${title}\n\n${info}\n\n<a:boost:1449497847094444083> *This privilege is active and ready to use.*`
              }
            ]
          }
        ]
      };

      return interaction.reply(perkPayload);
    }

    if (interaction.customId === 'modhelp_menu') {
      const category = interaction.values[0];
      let helpTitle = '';
      let helpContent = '';
      let color = 2303786;

      switch (category) {
        case 'mod_admin':
          helpTitle = '🛡️ Admin & System Commands';
          helpContent = '> **.v wissetup:** Bot initial configuration.\n> **.v blacklist [ID]:** Per-room blacklist.\n> **.v blist:** View room blacklist.\n> **.v bl:** Administrative global blacklist.\n> **.v wl:** Global whitelist or room access.\n> **.v clearpremium:** Wipe all premium data.';
          color = 15158332; // Red
          break;
        case 'mod_premium':
          helpTitle = '💎 Premium & Subscriptions';
          helpContent = '> **.v add member @user [time]:** Add subscriber.\n> **.v remove member @user:** Remove subscriber.\n> **.v whitelist @user:** Add permanent friend.\n> **.v unwhitelist @user:** Remove friend.\n> **.v whitelistlista:** Deploy global monitor.\n> **.v myoffer:** Check detailed status.';
          color = 16766720; // Gold
          break;
        case 'mod_voice':
          helpTitle = '🎙️ Voice Control Commands';
          helpContent = '> **.v lock/unlock:** Privacy toggle.\n> **.v hide/unhide:** Visibility toggle.\n> **.v limit [N]:** Set member capacity.\n> **.v name [Name]:** Change channel name.\n> **.v claim:** Take ownership of empty room.\n> **.v transfer @user:** Hand over control.';
          color = 3066993; // Green
          break;
        case 'mod_utility':
          helpTitle = '⚙️ Utilities & Statistics';
          helpContent = '> **.v vping:** Connectivity test.\n> **.v top:** Community leaderboard.\n> **.v list:** Active channels report.\n> **.v botjoin/leave:** Join/Leave voice system.\n> **.v help:** General user documentation.';
          color = 3447003; // Blue
          break;
      }

      const categoryPayload = {
        flags: 32768 | 64, // IS_COMPONENTS_V2 | EPHEMERAL
        components: [
          {
            type: 17, // CONTAINER
            accent_color: color,
            components: [
              {
                type: 10,
                content: `## ${helpTitle}\n\n${helpContent}\n\n<a:wisdoarrow:1453486894779338885> *For detailed usage of a specific command, use its dedicated help entry.*`
              }
            ]
          }
        ]
      };

      return interaction.reply(categoryPayload);
    }

    if (interaction.customId === 'open_panel') {
      const voiceChannel = interaction.member.voice.channel;

      if (!voiceChannel) {
        return interaction.reply({
          content: '> <a:warning_animated:1361729714259099809> **You must be in a voice channel!**',
          ephemeral: true
        });
      }

      const channelData = tempChannels.get(voiceChannel.id);

      if (!channelData) {
        return interaction.reply({
          content: '> <a:warning_animated:1361729714259099809> **This is not a temporary channel!**',
          ephemeral: true
        });
      }

      // Check owner
      if (channelData.ownerId !== interaction.user.id) {
        return interaction.reply({
          content: '> <a:warning_animated:1361729714259099809> **You are not the owner of this channel!**',
          ephemeral: true
        });
      }

      const targetRoleId = process.env.TEMP_ROOM_ROLE_ID || interaction.guild.id;
      const permissions = voiceChannel.permissionOverwrites.cache.get(targetRoleId);
      const isLocked = permissions?.deny?.has(PermissionFlagsBits.Connect) || false;
      const isHidden = permissions?.deny?.has(PermissionFlagsBits.ViewChannel) || false;
      const memberCount = voiceChannel.members.size;
      const userLimit = voiceChannel.userLimit || 'Unlimited';

      const controlPanelEmbed = new EmbedBuilder()
        .setTitle('🎛️ **CONTROL PANEL**')
        .setDescription(`
          > **<a:boost:1449497847094444083> Channel Information:**
          
          <a:org:1449141144268308595> **Owner:** <@${channelData.ownerId}>
          <:voice6:1358152460979404992> **Name:** \`${voiceChannel.name}\`
          <:voice4:1358152468273430718> **Limit:** \`${userLimit}\`
          <:voice2:1358152471687467228> **Members:** \`${memberCount}\`
          
          > **<a:notif:1447321335117123610> Status:**
          ${isLocked ? '<:voice3:1358152470081175622> **Locked**' : '<:voice1:1358152473403195555> **Unlocked**'} | ${isHidden ? '<a:Red_Eye:1450210370487718071> **Hidden**' : '<a:Eyes:1450279319971823789> **Visible**'}
        `)
        .setColor(0x2B2D31)
        .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
        .setTimestamp()
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() });

      const row1 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId('panel_lock').setLabel('LOCK').setEmoji('<:voice3:1358152470081175622>').setStyle(isLocked ? ButtonStyle.Success : ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('panel_unlock').setLabel('UNLOCK').setEmoji('<:voice1:1358152473403195555>').setStyle(!isLocked ? ButtonStyle.Success : ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('panel_rename').setLabel('RENAME').setEmoji('<:voice6:1358152460979404992>').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('panel_limit').setLabel('LIMIT').setEmoji('<:voice4:1358152468273430718>').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('panel_hide').setLabel('HIDE').setEmoji('<a:Red_Eye:1450210370487718071>').setStyle(isHidden ? ButtonStyle.Success : ButtonStyle.Secondary)
        );

      const row2 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId('panel_unhide').setLabel('UNHIDE').setEmoji('<a:Eyes:1450279319971823789>').setStyle(!isHidden ? ButtonStyle.Success : ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('panel_kick_all').setLabel('KICK ALL').setEmoji('<a:sssss:1450241657261002864>').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('panel_transfer').setLabel('TRANSFER').setEmoji('<a:12104crownpink:1449139449211387945>').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('panel_info').setLabel('INFO').setEmoji('<:voice2:1358152471687467228>').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('panel_delete').setLabel('DELETE').setEmoji('<:trash:1450280880881930341>').setStyle(ButtonStyle.Danger)
        );

      await interaction.reply({
        embeds: [controlPanelEmbed],
        components: [row1, row2],
        ephemeral: true
      });
    }

    if (interaction.customId === 'translate_darija') {
      const darijaEmbed = new EmbedBuilder()
        .setTitle('🎉 **مرحباً بك في قناتك الصوتية الخاصة!**')
        .setColor(0x2B2D31)
        .setAuthor({
          name: 'Wisdom TEMP System',
          iconURL: client.user.displayAvatarURL()
        })
        .setDescription(`
          > **<a:boost:1449497847094444083> أهلاً بك <@${interaction.user.id}>!**
          
          تم إنشاء قناتك بنجاح. عندك التحكم الكامل فيها باستخدام الأزرار ولا الأوامر.

          **<a:notif:1447321335117123610> أوامر سريعة:**

          > **<:voice3:1358152470081175622> قفل:** \`.v lock\`
          > **<:voice1:1358152473403195555> فتح:** \`.v unlock\`
          > **<:voice6:1358152460979404992> سمية:** \`.v name <text>\`
          > **<:voice4:1358152468273430718> ليميت:** \`.v limit <number>\`
          > **<a:Red_Eye:1450210370487718071> تخبية:** \`.v hide\`
          
          *استخدم \`.v help\` للمزيد من المعلومات.*
        `)
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

      const backRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('translate_english')
            .setLabel('Back to English')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🇺🇸'),
          new ButtonBuilder()
            .setCustomId('translate_amazigh')
            .setLabel('Translate to Amazigh')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:tamazight:1328392111963504771>')
        );

      await interaction.update({
        embeds: [darijaEmbed],
        components: [backRow]
      });
    }

    if (interaction.customId === 'translate_amazigh') {
      const amazighEmbed = new EmbedBuilder()
        .setTitle('🎉 **ⴰⵙⵓⴷⵓ ⵖⵔ ⵓⵙⴰⵔⴰⴳ ⵏ ⵜⵎⵙⵉⵡⵍⵜ!**')
        .setColor(0x2B2D31)
        .setAuthor({
          name: 'Wisdom TEMP System',
          iconURL: client.user.displayAvatarURL()
        })
        .setDescription(`
          > **<a:boost:1449497847094444083> ⴰⵣⵓⵍ <@${interaction.user.id}>!**
          
          ⵉⵜⵜⵓⵙⴽⴰⵔ ⵓⵙⴰⵔⴰⴳ ⵏⵏⴽ ⵙ ⵜⵎⴰⵎⵜ. ⵜⵣⵎⵔⴷ ⴰⴷ ⵜⵙⵏⵓⴱⴳⴷ ⴰⵙⴰⵔⴰⴳ ⵏⵏⴽ.

          **<a:notif:1447321335117123610> ⵜⵉⵏⵏⴰ ⵏ ⵓⵙⴽⵔ ⵜⵉⵎⵣⵡⵓⵔⴰ:**

          > **<:voice3:1358152470081175622> ⵔⴳⵍ:** \`.v lock\`
          > **<:voice1:1358152473403195555> ⵍⴷⵉ:** \`.v unlock\`
          > **<:voice6:1358152460979404992> ⵉⵙⵎ:** \`.v name <text>\`
          > **<:voice4:1358152468273430718> ⵓⵟⵟⵓⵏ:** \`.v limit <number>\`
          > **<a:Red_Eye:1450210370487718071> ⵙⵏⵜⵍ:** \`.v hide\`
          
          *ⵙⵎⵔⵙ \`.v help\` ⵃⵎⴰ ⴰⴷ ⵜⵙⴽⵏⴷ ⴰⴽⴽ ⵜⵉⵏⵏⴰ.*
        `)
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

      const backRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('translate_english')
            .setLabel('Back to English')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🇺🇸'),
          new ButtonBuilder()
            .setCustomId('translate_darija')
            .setLabel('Translate to Darija')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🇲🇦')
        );

      await interaction.update({
        embeds: [amazighEmbed],
        components: [backRow]
      });
    }

    if (interaction.customId === 'translate_english') {
      const englishEmbed = new EmbedBuilder()
        .setTitle('🎉 **Welcome to Your Temporary Voice Channel!**')
        .setColor(0x2B2D31)
        .setAuthor({
          name: 'Wisdom TEMP System',
          iconURL: client.user.displayAvatarURL()
        })
        .setDescription(`
          > **<a:boost:1449497847094444083> Hello <@${interaction.user.id}>!**
          
          Your private voice channel has been successfully created.
          You have full control over this channel using the commands below or the buttons.

          **<a:notif:1447321335117123610> Quick Commands:**

          > **<:voice3:1358152470081175622> Lock:** \`.v lock\`
          > **<:voice1:1358152473403195555> Unlock:** \`.v unlock\`
          > **<:voice6:1358152460979404992> Rename:** \`.v name <text>\`
          > **<:voice4:1358152468273430718> Limit:** \`.v limit <number>\`
          > **<a:Red_Eye:1450210370487718071> Hide:** \`.v hide\`
          
          *Use \`.v help\` or click the buttons below for more controls.*
        `)
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

      const translationRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('translate_darija')
            .setLabel('Translate to Darija')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🇲🇦'),
          new ButtonBuilder()
            .setCustomId('translate_amazigh')
            .setLabel('Translate to Amazigh')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:tamazight:1328392111963504771>')
        );

      await interaction.update({
        embeds: [englishEmbed],
        components: [translationRow]
      });
    }

    // Handle channel control buttons
    if (interaction.customId === 'channel_lock') {
      const voiceChannel = interaction.member.voice.channel;

      if (!voiceChannel) {
        return interaction.reply({
          content: '❌ يجب أن تكون في قناة صوتية لاستخدام هذا الزر!',
          ephemeral: true
        });
      }

      const channelData = tempChannels.get(voiceChannel.id);
      if (!channelData || channelData.ownerId !== interaction.user.id) {
        return interaction.reply({
          content: '❌ يمكن فقط لمالك القناة استخدام هذا الزر!',
          ephemeral: true
        });
      }

      try {
        if (process.env.TEMP_ROOM_ROLE_ID) {
          await voiceChannel.permissionOverwrites.edit(process.env.TEMP_ROOM_ROLE_ID, {
            Connect: false
          });

          await interaction.reply({
            content: '> 🔒 **Channel Locked!**',
            ephemeral: true
          });

          // Set voice channel status
          try {
            await fetch(`https://discord.com/api/v10/channels/${voiceChannel.id}/voice-status`, {
              method: 'PUT',
              headers: { 'Authorization': `Bot ${client.token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: '<:lock:1452014333965111398>  ** Room Masdoda**' })
            });
          } catch (e) { }
        } else {
          await interaction.reply({
            content: '> ⚠️ **Temp Room Role ID is not configured!**',
            ephemeral: true
          });
        }
      } catch (error) {
        await interaction.reply({
          content: '❌ حدث خطأ أثناء قفل القناة!',
          ephemeral: true
        });
      }
    }

    if (interaction.customId === 'channel_unlock') {
      const voiceChannel = interaction.member.voice.channel;

      if (!voiceChannel) {
        return interaction.reply({
          content: '❌ يجب أن تكون في قناة صوتية لاستخدام هذا الزر!',
          ephemeral: true
        });
      }

      const channelData = tempChannels.get(voiceChannel.id);
      if (!channelData || channelData.ownerId !== interaction.user.id) {
        return interaction.reply({
          content: '❌ يمكن فقط لمالك القناة استخدام هذا الزر!',
          ephemeral: true
        });
      }

      try {
        if (process.env.TEMP_ROOM_ROLE_ID) {
          await voiceChannel.permissionOverwrites.edit(process.env.TEMP_ROOM_ROLE_ID, {
            Connect: true
          });

          await interaction.reply({
            content: '> 🔓 **Channel Unlocked!**',
            ephemeral: true
          });

          // Restore default voice channel status
          try {
            await fetch(`https://discord.com/api/v10/channels/${voiceChannel.id}/voice-status`, {
              method: 'PUT',
              headers: { 'Authorization': `Bot ${client.token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: '**.v help/panel**  <a:FZ_red_cross:1360451122807963770>' })
            });
          } catch (e) { }
        } else {
          await interaction.reply({
            content: '> ⚠️ **Temp Room Role ID is not configured!**',
            ephemeral: true
          });
        }
      } catch (error) {
        await interaction.reply({
          content: '❌ حدث خطأ أثناء إلغاء قفل القناة!',
          ephemeral: true
        });
      }
    }

    if (interaction.customId === 'channel_rename') {
      const voiceChannel = interaction.member.voice.channel;

      if (!voiceChannel) {
        return interaction.reply({
          content: '❌ يجب أن تكون في قناة صوتية لاستخدام هذا الزر!',
          ephemeral: true
        });
      }

      const channelData = tempChannels.get(voiceChannel.id);
      if (!channelData || channelData.ownerId !== interaction.user.id) {
        return interaction.reply({
          content: '❌ يمكن فقط لمالك القناة استخدام هذا الزر!',
          ephemeral: true
        });
      }

      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

      const modal = new ModalBuilder()
        .setCustomId('rename_modal')
        .setTitle('تغيير اسم القناة');

      const nameInput = new TextInputBuilder()
        .setCustomId('new_name')
        .setLabel('الاسم الجديد للقناة')
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(100)
        .setPlaceholder('أدخل الاسم الجديد...')
        .setRequired(true);

      const firstActionRow = new ActionRowBuilder().addComponents(nameInput);
      modal.addComponents(firstActionRow);

      await interaction.showModal(modal);
    }

    if (interaction.customId === 'channel_hide') {
      const voiceChannel = interaction.member.voice.channel;

      if (!voiceChannel) {
        return interaction.reply({
          content: '❌ يجب أن تكون في قناة صوتية لاستخدام هذا الزر!',
          ephemeral: true
        });
      }

      const channelData = tempChannels.get(voiceChannel.id);
      if (!channelData || channelData.ownerId !== interaction.user.id) {
        return interaction.reply({
          content: '❌ يمكن فقط لمالك القناة استخدام هذا الزر!',
          ephemeral: true
        });
      }

      try {
        if (process.env.TEMP_ROOM_ROLE_ID) {
          await voiceChannel.permissionOverwrites.edit(process.env.TEMP_ROOM_ROLE_ID, {
            ViewChannel: false
          });
          await interaction.reply({
            content: '> 👁️ **Channel Hidden from Temp Role!**',
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: '> ⚠️ **Temp Room Role ID is not configured!**',
            ephemeral: true
          });
        }
      } catch (error) {
        await interaction.reply({
          content: '❌ حدث خطأ أثناء إخفاء القناة!',
          ephemeral: true
        });
      }
    }

    // Handle panel control buttons
    if (interaction.customId === 'panel_lock') {
      const result = await checkOwnership(interaction, tempChannels);
      if (!result) return;
      const { voiceChannel } = result;

      try {
        const targetRoleId = process.env.TEMP_ROOM_ROLE_ID || interaction.guild.id;
        await voiceChannel.permissionOverwrites.edit(targetRoleId, { [PermissionFlagsBits.Connect]: false });

        await setVoiceStatus(voiceChannel.id, client.token, '<:lock:1452014333965111398>  ** Room Masdoda**');

        await interaction.reply({ content: '> 🔒 **Channel Locked!**', ephemeral: true });
      } catch (error) {
        await interaction.reply({ content: '❌ حدث خطأ أثناء قفل القناة!', ephemeral: true });
      }
    }

    if (interaction.customId === 'panel_unlock') {
      const result = await checkOwnership(interaction, tempChannels);
      if (!result) return;
      const { voiceChannel } = result;

      try {
        const targetRoleId = process.env.TEMP_ROOM_ROLE_ID || interaction.guild.id;
        await voiceChannel.permissionOverwrites.edit(targetRoleId, { [PermissionFlagsBits.Connect]: true });

        await setVoiceStatus(voiceChannel.id, client.token, '**.v help/panel**  <a:FZ_red_cross:1360451122807963770>');

        await interaction.reply({ content: '> 🔓 **Channel Unlocked!**', ephemeral: true });
      } catch (error) {
        await interaction.reply({ content: '❌ حدث خطأ أثناء فتح القناة!', ephemeral: true });
      }
    }

    if (interaction.customId === 'panel_rename') {
      const result = await checkOwnership(interaction, tempChannels);
      if (!result) return;

      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const modal = new ModalBuilder().setCustomId('panel_rename_modal').setTitle('تغيير اسم القناة');
      const nameInput = new TextInputBuilder()
        .setCustomId('panel_new_name')
        .setLabel('الاسم الجديد للقناة')
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(90) // Enforce Safe Limit
        .setPlaceholder('أدخل الاسم الجديد...')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
      await interaction.showModal(modal);
    }

    if (interaction.customId === 'panel_limit') {
      const result = await checkOwnership(interaction, tempChannels);
      if (!result) return;

      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const modal = new ModalBuilder().setCustomId('panel_limit_modal').setTitle('تحديد عدد الأعضاء');
      const limitInput = new TextInputBuilder()
        .setCustomId('panel_user_limit')
        .setLabel('الحد الأقصى للأعضاء (0-99)')
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(2)
        .setPlaceholder('0 = غير محدود')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(limitInput));
      await interaction.showModal(modal);
    }

    if (interaction.customId === 'panel_hide') {
      const result = await checkOwnership(interaction, tempChannels);
      if (!result) return;
      const { voiceChannel } = result;

      try {
        const targetRoleId = process.env.TEMP_ROOM_ROLE_ID || interaction.guild.id;
        await voiceChannel.permissionOverwrites.edit(targetRoleId, { [PermissionFlagsBits.ViewChannel]: false });
        await interaction.reply({ content: '> 👁️ **Channel Hidden!**', ephemeral: true });
      } catch (error) {
        await interaction.reply({ content: '❌ حدث خطأ أثناء إخفاء القناة!', ephemeral: true });
      }
    }

    if (interaction.customId === 'panel_unhide') {
      const result = await checkOwnership(interaction, tempChannels);
      if (!result) return;
      const { voiceChannel } = result;

      try {
        const targetRoleId = process.env.TEMP_ROOM_ROLE_ID || interaction.guild.id;
        await voiceChannel.permissionOverwrites.edit(targetRoleId, { [PermissionFlagsBits.ViewChannel]: true });
        await interaction.reply({ content: '> 👀 **Channel Visible!**', ephemeral: true });
      } catch (error) {
        await interaction.reply({ content: '❌ حدث خطأ أثناء إظهار القناة!', ephemeral: true });
      }
    }

    if (interaction.customId === 'panel_kick_all') {
      const result = await checkOwnership(interaction, tempChannels);
      if (!result) return;
      const { voiceChannel } = result;

      await interaction.deferReply({ ephemeral: true });

      try {
        const members = voiceChannel.members.filter(member => member.id !== interaction.user.id && !member.user.bot);
        let count = 0;
        for (const member of members.values()) {
          try {
            await member.voice.disconnect();
            count++;
          } catch (e) { }
        }
        await interaction.editReply({ content: `👢 تم طرد ${count} عضو بنجاح!` });
      } catch (error) {
        await interaction.editReply({ content: '❌ حدث خطأ أثناء طرد الأعضاء!' });
      }
    }

    if (interaction.customId === 'panel_transfer') {
      const result = await checkOwnership(interaction, tempChannels);
      if (!result) return;
      const { voiceChannel } = result;

      const members = voiceChannel.members.filter(m => m.id !== interaction.user.id && !m.user.bot);
      if (members.size === 0) return interaction.reply({ content: '❌ لا يوجد أعضاء آخرين لنقل الملكية إليهم!', ephemeral: true });

      const { StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('panel_transfer_select')
        .setPlaceholder('اختر العضو الجديد...')
        .addOptions(members.map(m => ({ label: m.displayName, value: m.id, emoji: '👑' })));

      await interaction.reply({ content: '👑 اختر العضو الجديد:', components: [new ActionRowBuilder().addComponents(selectMenu)], ephemeral: true });
    }

    if (interaction.customId === 'panel_info') {
      const result = await checkOwnership(interaction, tempChannels);
      if (!result) return;
      const { voiceChannel, channelData } = result;

      const targetRoleId = process.env.TEMP_ROOM_ROLE_ID || interaction.guild.id;
      const perms = voiceChannel.permissionOverwrites.cache.get(targetRoleId);
      const infoEmbed = new EmbedBuilder()
        .setDescription(`
          <:voice6:1358152460979404992> **Name:** \`${voiceChannel.name}\`
          <a:org:1449141144268308595> **Owner:** <@${channelData.ownerId}>
          <:voice2:1358152471687467228> **Members:** \`${voiceChannel.members.size}\`
          <:voice4:1358152468273430718> **Limit:** \`${voiceChannel.userLimit || 'Unlimited'}\`
          <:voice3:1358152470081175622> **Status:** ${perms?.deny?.has(PermissionFlagsBits.Connect) ? 'Locked' : 'Unlocked'}
          <a:loading:1450241657261002864> **Created:** <t:${Math.floor((channelData.createdAt || Date.now()) / 1000)}:R>
        `)
        .setColor(0x2B2D31)
        .setFooter({ text: 'Wisdom TMPV - S Version ©', iconURL: client.user.displayAvatarURL() });

      await interaction.reply({ embeds: [infoEmbed], ephemeral: true });
    }

    if (interaction.customId === 'panel_delete') {
      const result = await checkOwnership(interaction, tempChannels);
      if (!result) return;

      const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_delete_confirm').setLabel('نعم، احذف القناة').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
        new ButtonBuilder().setCustomId('panel_delete_cancel').setLabel('إلغاء').setStyle(ButtonStyle.Secondary).setEmoji('❌')
      );

      await interaction.reply({ content: '⚠️ **تحذير!** هل أنت متأكد؟ هذا الإجراء لا يمكن التراجع عنه!', components: [row], ephemeral: true });
    }

    // Handle transfer select menu
    if (interaction.customId === 'panel_transfer_select') {
      await interaction.deferReply({ ephemeral: true });

      const result = await checkOwnership(interaction, tempChannels);
      if (!result) return interaction.editReply({ content: '❌ يجب أن تكون في القناة لنقل الملكية!' });
      const { voiceChannel, channelData } = result;

      const newOwnerId = interaction.values[0];
      const newOwner = await interaction.guild.members.fetch(newOwnerId).catch(() => null);

      if (!newOwner) return interaction.editReply({ content: '❌ تعذر العثور على العضو المختار!' });

      try {
        // Revoke old owner perms
        await voiceChannel.permissionOverwrites.edit(interaction.user.id, { ManageChannels: false, PrioritySpeaker: false }).catch(() => { });

        // Grant new owner perms
        await voiceChannel.permissionOverwrites.edit(newOwnerId, {
          Connect: true,
          ViewChannel: true,
          Speak: true,
          Stream: true
        });

        channelData.ownerId = newOwnerId;
        tempChannels.set(voiceChannel.id, channelData);

        await interaction.editReply({ content: `👑 تم نقل ملكية القناة بنجاح إلى ${newOwner.displayName}!` });
      } catch (error) {
        await interaction.editReply({ content: '❌ حدث خطأ أثناء نقل الملكية!' });
      }
    }

    // Handle delete confirmation
    if (interaction.customId === 'panel_delete_confirm') {
      const voiceChannel = interaction.member.voice.channel;

      if (!voiceChannel) {
        return interaction.reply({ content: '❌ يجب أن تكون في قناة صوتية!', ephemeral: true });
      }

      const channelData = tempChannels.get(voiceChannel.id);
      if (!channelData || channelData.ownerId !== interaction.user.id) {
        return interaction.reply({ content: '❌ يمكن فقط لمالك القناة حذف القناة!', ephemeral: true });
      }

      // Cancel any existing pending delete for this channel first
      if (pendingDeletes.has(voiceChannel.id)) {
        clearTimeout(pendingDeletes.get(voiceChannel.id));
      }

      const timeoutId = setTimeout(async () => {
        pendingDeletes.delete(voiceChannel.id);
        tempChannels.delete(voiceChannel.id);
        await voiceChannel.delete().catch(() => { });
        logger.info(`Channel deleted by owner: ${voiceChannel.id}`);
      }, 5000);

      pendingDeletes.set(voiceChannel.id, timeoutId);

      await interaction.reply({
        content: '🗑️ سيتم حذف القناة خلال **5 ثوانٍ**... اضغط إلغاء لوقف الحذف.',
        ephemeral: true
      });
    }

    if (interaction.customId === 'panel_delete_cancel') {
      const voiceChannel = interaction.member.voice.channel;
      if (voiceChannel && pendingDeletes.has(voiceChannel.id)) {
        clearTimeout(pendingDeletes.get(voiceChannel.id));
        pendingDeletes.delete(voiceChannel.id);
        await interaction.reply({ content: '✅ تم إلغاء عملية حذف القناة بنجاح.', ephemeral: true });
      } else {
        await interaction.reply({ content: '✅ لا توجد عملية حذف معلقة.', ephemeral: true });
      }
    }


    // --- Ask 2 Join Handlers ---
    if (interaction.customId === 'ask_2_join') {
      const targetRoleId = process.env.TEMP_ROOM_ROLE_ID || interaction.guild.id;
      const lockedChannels = [];

      for (const [id, data] of tempChannels) {
        const chan = interaction.guild.channels.cache.get(id);
        if (chan && chan.type === ChannelType.GuildVoice) {
          const perms = chan.permissionOverwrites.cache.get(targetRoleId);
          const isLocked = perms?.deny?.has(PermissionFlagsBits.Connect) || false;
          if (isLocked) {
            lockedChannels.push({
              label: chan.name.substring(0, 100),
              value: id,
              description: `Request entry to ${chan.name}`
            });
          }
        }
      }

      if (lockedChannels.length === 0) {
        return interaction.reply({ content: '❌ No locked rooms found at the moment.', ephemeral: true });
      }

      const { StringSelectMenuBuilder } = require('discord.js');
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('ask_select')
        .setPlaceholder('Select a locked room...')
        .addOptions(lockedChannels.slice(0, 25));

      const row = new ActionRowBuilder().addComponents(selectMenu);
      await interaction.reply({ content: '🚪 Choose the room you want to join:', components: [row], ephemeral: true });
    }

    if (interaction.customId === 'ask_select') {
      const channelId = interaction.values[0];
      const targetChannel = interaction.guild.channels.cache.get(channelId);
      const channelData = tempChannels.get(channelId);

      if (!targetChannel || !channelData) {
        return interaction.reply({ content: '❌ This channel no longer exists.', ephemeral: true });
      }

      await interaction.reply({ content: `⌛ Request sent to <@${channelData.ownerId}>. Please wait...`, ephemeral: true });

      const knockEmbed = new EmbedBuilder()
        .setTitle('🔔 **KNOCK KNOCK!**')
        .setDescription(`> <@${interaction.user.id}> requests permission to join your room.`)
        .setColor(0xFFA500)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setFooter({ text: 'Accept or Reject using the buttons below.' });

      // Store Interaction Channel ID in CustomID to notify requester later
      const knockRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`knock_acc_${interaction.user.id}_${interaction.channel.id}`).setLabel('Accept').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId(`knock_rej_${interaction.user.id}_${interaction.channel.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger).setEmoji('❌')
      );

      await targetChannel.send({ content: `<@${channelData.ownerId}>`, embeds: [knockEmbed], components: [knockRow] });
    }

    if (interaction.customId.startsWith('knock_acc_')) {
      const [, , requesterId, notifyChannelId] = interaction.customId.split('_');
      const voiceChannel = interaction.member.voice.channel;
      const channelData = tempChannels.get(voiceChannel?.id);

      if (!voiceChannel || !channelData || channelData.ownerId !== interaction.user.id) {
        return interaction.reply({ content: '❌ يمكن فقط لمالك القناة قبول الطلبات!', ephemeral: true });
      }

      await voiceChannel.permissionOverwrites.edit(requesterId, {
        Connect: true,
        Speak: true,
        UseVAD: true,
        ViewChannel: true,
        SendMessages: true
      });

      await interaction.update({ content: `✅ <@${requesterId}> has been allowed !`, embeds: [], components: [] });

      // Notify requester in the original interaction channel
      const notifyChan = interaction.guild.channels.cache.get(notifyChannelId);
      if (notifyChan) {
        const notifyEmbed = new EmbedBuilder().setColor(0x00FF00).setDescription(`✅ **Accepted!** You can now join <#${voiceChannel.id}>.`);
        const notifyMsg = await notifyChan.send({ content: `<@${requesterId}>`, embeds: [notifyEmbed] });
        setTimeout(() => notifyMsg.delete().catch(() => { }), 3 * 60 * 1000);
      }
    }

    if (interaction.customId.startsWith('knock_rej_')) {
      const [, , requesterId, notifyChannelId] = interaction.customId.split('_');
      const voiceChannel = interaction.member.voice.channel;
      const channelData = tempChannels.get(voiceChannel?.id);

      if (!voiceChannel || !channelData || channelData.ownerId !== interaction.user.id) {
        return interaction.reply({ content: '❌ يمكن فقط لمالك القناة رفض الطلبات!', ephemeral: true });
      }

      await interaction.update({ content: `❌ Request from <@${requesterId}> was rejected.`, embeds: [], components: [] });

      const notifyChan = interaction.guild.channels.cache.get(notifyChannelId);
      if (notifyChan) {
        const notifyEmbed = new EmbedBuilder().setColor(0xFF0000).setDescription(`❌ **Rejected!** Your request to join the room was denied.`);
        const notifyMsg = await notifyChan.send({ content: `<@${requesterId}>`, embeds: [notifyEmbed] });
        setTimeout(() => notifyMsg.delete().catch(() => { }), 3 * 60 * 1000);
      }
    }
    // ----------------------------

  } catch (error) {
    console.error('❌ Discord Client Error:', error);

    // Try to respond to the interaction if it hasn't been responded to yet
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ حدث خطأ أثناء معالجة طلبك. يرجى المحاولة مرة أخرى.',
          ephemeral: true
        });
      }
    } catch (replyError) {
      console.error('❌ Failed to send error response:', replyError);
    }
  }
});

// Handle modal submissions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isModalSubmit()) return;

  // Add error handling wrapper
  try {
    // Check if interaction is already replied to or deferred
    if (interaction.replied || interaction.deferred) return;

    // Check if this interaction has already been processed
    if (processedInteractions.has(interaction.id)) return;
    processedInteractions.add(interaction.id);

    if (interaction.customId === 'rename_modal') {
      const voiceChannel = interaction.member.voice.channel;

      if (!voiceChannel) {
        return interaction.reply({
          content: '❌ يجب أن تكون في قناة صوتية!',
          ephemeral: true
        });
      }

      const channelData = tempChannels.get(voiceChannel.id);
      if (!channelData || channelData.ownerId !== interaction.user.id) {
        return interaction.reply({
          content: '❌ يمكن فقط لمالك القناة تغيير الاسم!',
          ephemeral: true
        });
      }

      const newName = interaction.fields.getTextInputValue('new_name');

      try {
        await voiceChannel.setName(newName);
        await interaction.reply({
          content: `✏️ تم تغيير اسم القناة إلى: **${newName}**`,
          ephemeral: true
        });
      } catch (error) {
        await interaction.reply({
          content: '❌ حدث خطأ أثناء تغيير اسم القناة!',
          ephemeral: true
        });
      }
    }

    // Handle panel rename modal
    if (interaction.customId === 'panel_rename_modal') {
      const result = await checkOwnership(interaction, tempChannels);
      if (!result) return;
      const { voiceChannel } = result;

      const newName = interaction.fields.getTextInputValue('panel_new_name');
      try {
        await voiceChannel.setName(`🔊｜${newName}`);
        await interaction.reply({ content: `✏️ تم تغيير اسم القناة بنجاح إلى: **${newName}**`, ephemeral: true });
      } catch (error) {
        await interaction.reply({ content: '❌ حدث خطأ أثناء تغيير اسم القناة! قد يكون هناك ضغط (Rate Limit).', ephemeral: true });
      }
    }

    // Handle panel limit modal
    if (interaction.customId === 'panel_limit_modal') {
      const result = await checkOwnership(interaction, tempChannels);
      if (!result) return;
      const { voiceChannel } = result;

      const limitInput = interaction.fields.getTextInputValue('panel_user_limit');
      const userLimit = parseInt(limitInput);

      if (isNaN(userLimit) || userLimit < 0 || userLimit > 99) {
        return interaction.reply({ content: '❌ يجب أن يكون الرقم بين 0 و 99!', ephemeral: true });
      }

      try {
        await voiceChannel.setUserLimit(userLimit);
        await interaction.reply({ content: `🔢 تم تحديد عدد الأعضاء بنجاح إلى: **${userLimit === 0 ? 'غير محدود' : userLimit}**`, ephemeral: true });
      } catch (error) {
        await interaction.reply({ content: '❌ حدث خطأ أثناء تحديد عدد الأعضاء!', ephemeral: true });
      }
    }

  } catch (error) {
    console.error('❌ Modal Submission Error:', error);

    // Try to respond to the interaction if it hasn't been responded to yet
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ حدث خطأ أثناء معالجة طلبك. يرجى المحاولة مرة أخرى.',
          ephemeral: true
        });
      }
    } catch (replyError) {
      console.error('❌ Failed to send error response:', replyError);
    }
  }
});

// ── Client error events ───────────────────────────────────────────────────
client.on('error', (error) => logger.error('Discord Client Error', error));
client.on('warn', (warning) => logger.warn(`Discord Warning: ${warning}`));
// ─────────────────────────────────────────────────────────────────────────

// ── Ready handler (invoked after successful login) ──────────────────────────
async function handleClientReady() {
  logger.success(`Logged in as ${client.user.tag}`);
  logger.info(`Connected to ${client.guilds.cache.size} guild(s)`);
  logger.info(`Serving ${client.users.cache.size} cached user(s)`);

  client.user.setPresence({
    activities: [{ name: 'Voice Channels | .v help', type: 3 }],
    status: 'online',
  });

  // Connect to Create Room in every guild
  for (const guild of client.guilds.cache.values()) {
    await connectToCreateRoom(guild).catch(e => logger.error('connectToCreateRoom failed', e));
  }
}
// ─────────────────────────────────────────────────────────────────────────

// ── Role update: sync permissions to members in temp channels ─────────────
client.on('roleUpdate', async (oldRole, newRole) => {
  if (newRole.id !== process.env.TEMP_ROOM_ROLE_ID) return;
  logger.info(`Temp room role updated: ${newRole.name} — syncing member permissions...`);

  for (const [channelId, channelData] of tempChannels) {
    try {
      const channel = newRole.guild.channels.cache.get(channelId);
      if (!channel) continue;

      const rolePermissions = channel.permissionOverwrites.cache.get(process.env.TEMP_ROOM_ROLE_ID);
      if (!rolePermissions || channel.members.size === 0) continue;

      for (const [memberId, member] of channel.members) {
        if (memberId === channelData.ownerId) continue;
        const userPermissions = {};
        rolePermissions.allow?.toArray().forEach(p => { userPermissions[p] = true; });
        rolePermissions.deny?.toArray().forEach(p => { userPermissions[p] = false; });
        await channel.permissionOverwrites.edit(memberId, userPermissions);
        logger.info(`Updated permissions for ${member.user.displayName} in ${channel.name}`);
      }
    } catch (error) {
      logger.error(`Error updating permissions for channel ${channelId}`, error);
    }
  }
  logger.success('Finished syncing member permissions after role update.');
});
// ─────────────────────────────────────────────────────────────────────────

// ── Graceful shutdown ─────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  logger.warn(`Received ${signal} — saving data and shutting down...`);
  tempChannelsObj = mapToObject(tempChannels);
  saveChannels(tempChannelsObj);
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Single registration for unhandled errors (no duplicates)
process.on('unhandledRejection', (err) => logger.error('UnhandledRejection', err));
process.on('uncaughtException', (err) => logger.error('UncaughtException', err));
// ─────────────────────────────────────────────────────────────────────────

// ── Bot login with auto-retry ─────────────────────────────────────────────
async function initSodium() {
  // Try to load sodium-native first, fallback to libsodium-wrappers (WASM)
  try {
    const sodiumNative = require('sodium-native');
    logger.info('sodium-native loaded successfully');
    return 'sodium-native';
  } catch (e) {
    logger.debug('sodium-native not available, trying libsodium-wrappers');
  }

  try {
    const libsodium = require('libsodium-wrappers');
    if (libsodium && libsodium.ready) await libsodium.ready;
    logger.info('libsodium-wrappers initialized successfully');
    return 'libsodium-wrappers';
  } catch (e) {
    logger.error('No sodium backend could be initialized', e);
    return null;
  }
}

async function startBot() {
  logger.info('Starting WISDOM TEMP Bot...');
  const backend = await initSodium();
  if (!backend) {
    logger.warn('No encryption backend available. Voice may not work correctly.');
  } else {
    logger.info(`Using encryption backend: ${backend}`);
  }

  // Connect to MongoDB
  await connectDB();

  try {
    await client.login(process.env.DISCORD_TOKEN);
    // After login completes, run ready handler
    await handleClientReady();
  } catch (error) {
    logger.error('Failed to login. Retrying in 5 seconds...', error);
    setTimeout(startBot, 5000);
  }
}

startBot();
