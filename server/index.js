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

/**
 * Waitlist signup.
 *
 *   POST /waitlist   { name, email }
 *
 * The parsing is split out from the handler because everything after it is a
 * Mongo round-trip: `parseWaitlistSignup` is the part that can be unit-tested
 * without a database, and it is where every rejection a caller can fix lives.
 */
const NAME_MAX = 80;
const EMAIL_MAX = 254; // RFC 5321's maximum reverse-path length
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

function parseWaitlistSignup(body) {
  const raw = body && typeof body === 'object' ? body : {};
  // Collapse internal runs of whitespace too — a name pasted out of a form
  // field otherwise stores as "Ada   Lovelace" and reads as a typo later.
  const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : '';
  const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';

  if (!name) return { error: 'Your name is required' };
  if (name.length > NAME_MAX) {
    return { error: `Name must be ${NAME_MAX} characters or fewer` };
  }
  if (!email) return { error: 'Email is required' };
  if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
    return { error: 'A valid email address is required' };
  }
  return { value: { name, email } };
}

/** The one answer a successful signup ever gets. Shared with the duplicate
 *  path below, and exported so a test can assert the two are identical. */
const SIGNUP_ACCEPTED = Object.freeze({ status: 201, body: { message: "You're on the waitlist" } });

/**
 * Maps a failed write to what the caller is told.
 *
 * A repeat signup answers with SIGNUP_ACCEPTED — the same status and the same
 * bytes as a new one. It is only detectable at the write (the unique index on
 * `email` is what rejects it), and the obvious response is a 409 saying so.
 * That 409 is an email-enumeration oracle: anyone could put a colleague's
 * address into the public form and be told whether that person had signed up.
 * The list is private, so membership in it is private too, and the endpoint
 * must not answer that question for an address the caller does not own.
 *
 * Nothing is written either way, and nothing is logged: a duplicate-key error
 * carries the offending email in `keyValue`, and console.error would copy it
 * into the platform's request log for no operational benefit.
 */
function waitlistWriteOutcome(error) {
  if (error && (error.code === 11000 || error.code === 11001)) {
    return SIGNUP_ACCEPTED;
  }
  if (error && error.name === 'ValidationError') {
    return {
      status: 400,
      body: { error: 'Your name and a valid email address are required' },
    };
  }
  console.error('Error adding email to waitlist:', error);
  return { status: 500, body: { error: 'Internal server error' } };
}

async function waitlistHandler(req, res) {
  const parsed = parseWaitlistSignup(req.body);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  try {
    await connectToDatabase();
    const User = require('./models/user');
    await new User(parsed.value).save();
    res.status(SIGNUP_ACCEPTED.status).json(SIGNUP_ACCEPTED.body);
  } catch (error) {
    const outcome = waitlistWriteOutcome(error);
    res.status(outcome.status).json(outcome.body);
  }
}

app.post('/waitlist', waitlistHandler);

/**
 * There is deliberately NO route that reads signups back out.
 *
 * `GET /waitlist` used to return every row, so the whole list — and, once the
 * form started collecting names, who those people were — was one unauthenticated
 * request away. It was replaced with a token-gated export and then removed
 * outright on 3 Sep 2026: nothing in either frontend ever called it, and a
 * credential that exists is a credential that can leak, be committed, or be left
 * unset on a redeploy. The list is read from Mongo directly instead, where it is
 * already behind the database's own auth.
 *
 * If a programmatic export is ever needed again, take the authenticated version
 * out of git history rather than reinstating an open one. Whatever replaces this
 * comment must require a credential and must fail CLOSED without one.
 */

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
module.exports.waitlistHandler = waitlistHandler;
module.exports.parseWaitlistSignup = parseWaitlistSignup;
module.exports.waitlistWriteOutcome = waitlistWriteOutcome;
module.exports.SIGNUP_ACCEPTED = SIGNUP_ACCEPTED;
