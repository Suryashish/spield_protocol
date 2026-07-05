const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3000;
const mongoose = require('mongoose');

// Cache the connection across serverless invocations. On Vercel each cold start
// re-runs this module, so without caching we'd open a new connection per request
// and exhaust the Mongo connection pool.
let connectionPromise = null;

function connectToDatabase() {
  if (mongoose.connection.readyState === 1) {
    return Promise.resolve();
  }
  if (!connectionPromise) {
    if (!process.env.MONGO_URL) {
      return Promise.reject(new Error('MONGO_URL environment variable is not set'));
    }
    connectionPromise = mongoose.connect(process.env.MONGO_URL).then(() => {
      console.log('Connected to MongoDB');
    }).catch((error) => {
      // Reset so the next request can retry instead of caching a failed promise.
      connectionPromise = null;
      throw error;
    });
  }
  return connectionPromise;
}

// Enable CORS for all routes
app.use(cors());

// Parse JSON bodies (express.json is built in on Express 5)
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello, Spield Waitlist API!');
});

app.post('/waitlist', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    await connectToDatabase();
    const User = require('./models/user');
    const newUser = new User({ email });
    await newUser.save();
    res.status(201).json({ message: 'Email added to waitlist' });
  } catch (error) {
    console.error('Error adding email to waitlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/waitlist', async (req, res) => {
  try {
    await connectToDatabase();
    const User = require('./models/user');
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    console.error('Error fetching waitlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Activity proxy.
 *
 * The dashboard's activity feed needs contract-event history. The Soroban RPC
 * only retains a rolling ~7-day window, so older transactions are gone from it;
 * stellar.expert indexes full history but BLOCKS cross-origin browser requests
 * (returns 403 on any Origin, sends no CORS headers). So the browser can't call
 * it directly. We proxy it here — server-to-server has no CORS constraint — and
 * hand the browser the raw event records (which it already knows how to decode).
 *
 *   GET /activity?contract=<C...>&network=testnet|public&limit=100
 */
app.get('/activity', async (req, res) => {
  const { contract } = req.query;
  const network = req.query.network === 'public' ? 'public' : 'testnet';
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

  // Only proxy well-formed Soroban contract ids (C… + base32), so this can't be
  // turned into an open relay to arbitrary explorer paths.
  if (typeof contract !== 'string' || !/^C[A-Z2-7]{55}$/.test(contract)) {
    return res.status(400).json({ error: 'A valid contract id (C…) is required' });
  }

  const url =
    `https://api.stellar.expert/explorer/${network}/contract/${contract}` +
    `/events?order=desc&limit=${limit}`;

  try {
    const upstream = await fetch(url, { headers: { accept: 'application/json' } });
    if (!upstream.ok) {
      return res
        .status(502)
        .json({ error: `Explorer returned ${upstream.status}`, records: [] });
    }
    const json = await upstream.json();
    const records = (json && json._embedded && json._embedded.records) || [];
    // Cache briefly at the edge — event history is append-only and the feed
    // polls on refresh, so a short TTL cuts upstream load without going stale.
    res.set('Cache-Control', 'public, max-age=15');
    res.json({ records });
  } catch (error) {
    console.error('Error proxying activity:', error);
    res.status(502).json({ error: 'Failed to reach explorer', records: [] });
  }
});

// Only start a long-running HTTP server when run directly (local dev).
// On Vercel the app is imported as a serverless handler, so app.listen()
// must not run — it would crash the function invocation.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;
