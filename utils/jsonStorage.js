const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const client = new MongoClient(uri);
let db;
let channelsCache = {};

async function ensureDB() {
  if (db) return db;
  try {
    await client.connect();
    db = client.db('wisdom_temp_bot');
    return db;
  } catch (error) {
    console.error('Error connecting to MongoDB for channel storage:', error.message);
    return null;
  }
}

// Warm cache from MongoDB (non-blocking)
async function hydrateChannelsCache() {
  const dbRef = await ensureDB();
  if (!dbRef) return;
  try {
    const doc = await dbRef.collection('bot_state').findOne({ key: 'temp_channels' });
    channelsCache = doc?.value || {};
  } catch (error) {
    console.error('Error hydrating channels cache:', error);
  }
}
hydrateChannelsCache();

function loadChannels() {
  return channelsCache || {};
}

function saveChannels(channels) {
  channelsCache = channels || {};
  ensureDB()
    .then((dbRef) => {
      if (!dbRef) return;
      return dbRef.collection('bot_state').updateOne(
        { key: 'temp_channels' },
        { $set: { value: channelsCache, updatedAt: new Date() } },
        { upsert: true }
      );
    })
    .catch((error) => console.error('Error saving channels to MongoDB:', error));
}

// Convert Map to object for storage
function mapToObject(map) {
  const obj = {};
  for (const [key, value] of map.entries()) {
    obj[key] = value;
  }
  return obj;
}

// Convert object to Map for usage
function objectToMap(obj) {
  const map = new Map();
  for (const key in obj) {
    map.set(key, obj[key]);
  }
  return map;
}

module.exports = {
  loadChannels,
  saveChannels,
  mapToObject,
  objectToMap
};