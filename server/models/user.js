const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Joined the schema on 2026-09-03 with the site's join-waitlist form. `required`
  // is enforced on save, not on read, so the rows written before it still load.
  name: { type: String, required: true, trim: true, maxlength: 80 },
  // Stored lowercase so the unique index actually catches a repeat signup: the
  // Mongo index is byte-exact, and "Ada@x.com" and "ada@x.com" are one person.
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    maxlength: 254,
  },
  createdAt: { type: Date, default: Date.now }
});

// Reuse an already-compiled model on warm serverless invocations to avoid
// OverwriteModelError when this module is required more than once.
const User =
  mongoose.models['Spield-Waitlist-User'] ||
  mongoose.model('Spield-Waitlist-User', userSchema);

module.exports = User;
