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
 * `contract` accepts one id or a comma-separated list. Each explorer endpoint is
 * queried independently because stellar.expert only accepts one contract per
 * request; the results are then merged into one newest-first feed.
 *
 *   GET /activity?contract=<C...>[,<C...>]&network=testnet|public&limit=100
 */
async function activityHandler(req, res) {
  const { contract } = req.query;
  const network = req.query.network === 'public' ? 'public' : 'testnet';
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

  // Only proxy a small, bounded set of well-formed Soroban contract ids (C… +
  // base32), so this cannot become an open relay or an unbounded fan-out request.
  const contracts =
    typeof contract === 'string'
      ? [...new Set(contract.split(',').map((id) => id.trim()).filter(Boolean))]
      : [];
  if (
    contracts.length === 0 ||
    contracts.length > 10 ||
    contracts.some((id) => !/^C[A-Z2-7]{55}$/.test(id))
  ) {
    return res.status(400).json({
      error: 'One to ten valid contract ids (C…), separated by commas, are required',
    });
  }

  try {
    const responses = await Promise.all(
      contracts.map(async (contractId) => {
        const url =
          `https://api.stellar.expert/explorer/${network}/contract/${contractId}` +
          `/events?order=desc&limit=${limit}`;
        const upstream = await fetch(url, { headers: { accept: 'application/json' } });
        if (!upstream.ok) {
          const error = new Error(`Explorer returned ${upstream.status}`);
          error.upstreamStatus = upstream.status;
          throw error;
        }
        const json = await upstream.json();
        return (json && json._embedded && json._embedded.records) || [];
      }),
    );

    // A transaction can emit events from several watched contracts. Event ids are
    // globally ordered paging tokens, but include the contract in the key as a
    // defensive fallback for explorer responses that omit or reuse an id.
    const seen = new Set();
    const records = responses
      .flat()
      .sort(
        (a, b) =>
          Number(b.ts || 0) - Number(a.ts || 0) ||
          String(b.id).localeCompare(String(a.id)),
      )
      .filter((record) => {
        const key = `${record.contract || ''}:${record.id || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);

    // Cache briefly at the edge — event history is append-only and the feed
    // polls on refresh, so a short TTL cuts upstream load without going stale.
    res.set('Cache-Control', 'public, max-age=15');
    res.json({ records });
  } catch (error) {
    if (error && error.upstreamStatus) {
      return res
        .status(502)
        .json({ error: `Explorer returned ${error.upstreamStatus}`, records: [] });
    }
    console.error('Error proxying activity:', error);
    res.status(502).json({ error: 'Failed to reach explorer', records: [] });
  }
}

app.get('/activity', activityHandler);

// Only start a long-running HTTP server when run directly (local dev).
// On Vercel the app is imported as a serverless handler, so app.listen()
// must not run — it would crash the function invocation.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;
// Exposed on the Express handler for focused unit tests without opening a port.
module.exports.activityHandler = activityHandler;
