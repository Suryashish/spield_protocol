const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});

// Reuse an already-compiled model on warm serverless invocations to avoid
// OverwriteModelError when this module is required more than once.
const User =
  mongoose.models['Spield-Waitlist-User'] ||
  mongoose.model('Spield-Waitlist-User', userSchema);

module.exports = User;
