const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3000;
const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URL).then(() => {
  console.log('Connected to MongoDB');
}).catch((error) => {
  console.error('Error connecting to MongoDB:', error);
});

// Enable CORS for all routes
app.use(cors());

// Parse JSON bodies
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('Hello, Spield Waitlist API!');
});

app.post('/waitlist', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
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
    const User = require('./models/user');
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    console.error('Error fetching waitlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});