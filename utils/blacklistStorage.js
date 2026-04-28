const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const client = new MongoClient(uri);
let db;
let blacklistCache = {};

async function ensureDB() {
    if (db) return db;
    try {
        await client.connect();
        db = client.db('wisdom_temp_bot');
        return db;
    } catch (error) {
        console.error('Error connecting to MongoDB for blacklist storage:', error.message);
        return null;
    }
}

async function persistBlacklist() {
    const dbRef = await ensureDB();
    if (!dbRef) return;
    await dbRef.collection('bot_state').updateOne(
        { key: 'global_blacklist' },
        { $set: { value: blacklistCache, updatedAt: new Date() } },
        { upsert: true }
    );
}

async function hydrateBlacklist() {
    const dbRef = await ensureDB();
    if (!dbRef) return;
    try {
        const doc = await dbRef.collection('bot_state').findOne({ key: 'global_blacklist' });
        blacklistCache = doc?.value || {};
    } catch (error) {
        console.error('Error hydrating blacklist cache:', error);
    }
}
hydrateBlacklist();

// simple sanity check for Discord IDs
function isValidDiscordId(id) {
  return typeof id === 'string' && /^[0-9]{17,20}$/.test(id);
}

function loadBlacklist() {
  try {
    const parsed = blacklistCache || {};
    // Clean up expired ones
    const now = Date.now();
    let changed = false;
    for (const userId in parsed) {
      if (!isValidDiscordId(userId)) {
        // remove any malformed key just in case
        delete parsed[userId];
        changed = true;
        continue;
      }
            if (parsed[userId].expiresAt && parsed[userId].expiresAt < now) {
                delete parsed[userId];
                changed = true;
            }
        }
        if (changed) saveBlacklist(parsed);
        return parsed;
    } catch (error) {
        console.error('Error loading blacklist data:', error);
        return {};
    }
}

function saveBlacklist(blacklist) {
    blacklistCache = blacklist || {};
    persistBlacklist().catch((error) => {
        console.error('Error saving blacklist data to MongoDB:', error);
    });
}

function isBlacklisted(userId) {
    if (!isValidDiscordId(userId)) return null;
    const blacklist = loadBlacklist();
    if (blacklist[userId]) {
        const entry = blacklist[userId];
        if (!entry.expiresAt || entry.expiresAt > Date.now()) {
            return entry;
        } else {
            // Already expired (the loadBlacklist cleanup should handle this too)
            return null;
        }
    }
    return null;
}

function addBlacklist(userId, moderatorId, expiresAt, reason) {
    if (!isValidDiscordId(userId)) return;
    const blacklist = loadBlacklist();
    blacklist[userId] = {
        moderatorId,
        expiresAt, // can be null for permanent
        reason,
        timestamp: Date.now()
    };
    saveBlacklist(blacklist);
}

function removeBlacklist(userId) {
    const blacklist = loadBlacklist();
    if (blacklist[userId]) {
        delete blacklist[userId];
        saveBlacklist(blacklist);
        return true;
    }
    return false;
}

module.exports = { loadBlacklist, saveBlacklist, isBlacklisted, addBlacklist, removeBlacklist };
