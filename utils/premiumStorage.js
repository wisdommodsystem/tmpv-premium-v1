const { MongoClient } = require('mongodb');

// MongoDB connection
const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const client = new MongoClient(uri);
let db;

async function connectDB(retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      if (client.topology && client.topology.isConnected()) return;
      await client.connect();
      db = client.db('wisdom_temp_bot');
      console.log('[MongoDB] Connected successfully');
      return;
    } catch (error) {
      console.error(`[MongoDB] Connection attempt ${i + 1} failed:`, error.message);
      if (i === retries - 1) {
        console.error('[MongoDB] Max retries reached. Database features will be unavailable.');
      } else {
        await new Promise(res => setTimeout(res, 3000));
      }
    }
  }
}

// Global safety check
function checkDB() {
  if (!db) {
    // console.warn('[MongoDB] Database not connected. Feature ignored.');
    return false;
  }
  return true;
}

// Premium Members Collection
async function getPremiumMember(userId) {
  if (!checkDB()) return null;
  try {
    const collection = db.collection('premium_members');
    return await collection.findOne({ userId });
  } catch (error) {
    console.error('Error getting premium member:', error);
    return null;
  }
}

async function addPremiumMember(userId, addedBy, duration, offer, reason) {
  if (!checkDB()) return false;
  try {
    const collection = db.collection('premium_members');
    const expiresAt = duration === 'permanent' ? null : new Date(Date.now() + parseDuration(duration));
    const member = {
      userId,
      addedBy,
      addedAt: new Date(),
      expiresAt,
      offer,
      reason,
      isActive: true
    };
    await collection.updateOne({ userId }, { $set: member }, { upsert: true });
    return true;
  } catch (error) {
    console.error('Error adding premium member:', error);
    return false;
  }
}

async function removePremiumMember(userId, removedBy, reason) {
  if (!checkDB()) return false;
  try {
    const collection = db.collection('premium_members');
    await collection.updateOne(
      { userId },
      {
        $set: {
          isActive: false,
          removedBy,
          removedAt: new Date(),
          removeReason: reason
        }
      }
    );
    return true;
  } catch (error) {
    console.error('Error removing premium member:', error);
    return false;
  }
}

async function listPremiumMembers() {
  if (!checkDB()) return [];
  try {
    const collection = db.collection('premium_members');
    return await collection.find({ isActive: true }).toArray();
  } catch (error) {
    console.error('Error listing premium members:', error);
    return [];
  }
}

async function isPremiumMember(userId) {
  if (!checkDB()) return false;
  try {
    const member = await getPremiumMember(userId);
    if (!member || !member.isActive) return false;
    if (member.expiresAt && member.expiresAt <= new Date()) return false;
    return member; // Return the full member object so we can read .offer
  } catch (error) {
    console.error('Error checking premium status:', error);
    return false;
  }
}

// Room Settings Collection
async function saveRoomSettings(userId, settings) {
  if (!checkDB()) return false;
  try {
    const collection = db.collection('room_settings');
    await collection.updateOne(
      { userId },
      {
        $set: {
          settings,
          lastUpdated: new Date()
        }
      },
      { upsert: true }
    );
    return true;
  } catch (error) {
    console.error('Error saving room settings:', error);
    return false;
  }
}

async function getRoomSettings(userId) {
  if (!checkDB()) return null;
  try {
    const collection = db.collection('room_settings');
    const doc = await collection.findOne({ userId });
    return doc ? doc.settings : null;
  } catch (error) {
    console.error('Error getting room settings:', error);
    return null;
  }
}

function parseDuration(duration) {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return 0;
  const amount = parseInt(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return amount * multipliers[unit];
}

async function clearAllPremiumMembers() {
  if (!checkDB()) return false;
  try {
    const collection = db.collection('premium_members');
    await collection.deleteMany({});
    return true;
  } catch (error) {
    console.error('Error clearing premium members:', error);
    return false;
  }
}

// Whitelist Management
async function addToWhitelist(ownerId, targetId) {
  if (!checkDB()) return false;
  try {
    const collection = db.collection('whitelists');
    await collection.updateOne(
      { ownerId },
      { $addToSet: { whitelistedIds: targetId } },
      { upsert: true }
    );
    return true;
  } catch (error) {
    console.error('Error adding to whitelist:', error);
    return false;
  }
}

async function removeFromWhitelist(ownerId, targetId) {
  if (!checkDB()) return false;
  try {
    const collection = db.collection('whitelists');
    await collection.updateOne(
      { ownerId },
      { $pull: { whitelistedIds: targetId } }
    );
    return true;
  } catch (error) {
    console.error('Error removing from whitelist:', error);
    return false;
  }
}

async function getWhitelist(ownerId) {
  if (!checkDB()) return [];
  try {
    const collection = db.collection('whitelists');
    const doc = await collection.findOne({ ownerId });
    return doc ? doc.whitelistedIds || [] : [];
  } catch (error) {
    console.error('Error getting whitelist:', error);
    return [];
  }
}

async function getAllWhitelists() {
  if (!checkDB()) return [];
  try {
    const collection = db.collection('whitelists');
    return await collection.find({}).toArray();
  } catch (error) {
    console.error('Error getting all whitelists:', error);
    return [];
  }
}

async function savePanelData(guildId, channelId, messageId, type) {
  if (!checkDB()) return false;
  try {
    const collection = db.collection('global_panels');
    await collection.updateOne(
      { guildId, type },
      { $set: { channelId, messageId, lastUpdated: new Date() } },
      { upsert: true }
    );
    return true;
  } catch (error) {
    console.error('Error saving panel data:', error);
    return false;
  }
}

async function getPanelData(guildId, type) {
  if (!checkDB()) return null;
  try {
    const collection = db.collection('global_panels');
    return await collection.findOne({ guildId, type });
  } catch (error) {
    console.error('Error getting panel data:', error);
    return null;
  }
}

module.exports = {
  connectDB,
  getPremiumMember,
  addPremiumMember,
  removePremiumMember,
  listPremiumMembers,
  clearAllPremiumMembers,
  addToWhitelist,
  removeFromWhitelist,
  getWhitelist,
  getAllWhitelists,
  savePanelData,
  getPanelData,
  isPremiumMember,
  saveRoomSettings,
  getRoomSettings
};