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

// Only start a long-running HTTP server when run directly (local dev).
// On Vercel the app is imported as a serverless handler, so app.listen()
// must not run — it would crash the function invocation.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;
