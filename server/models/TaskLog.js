const mongoose = require('mongoose');

const taskLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenId: { type: mongoose.Schema.Types.ObjectId, ref: 'GameToken', required: true, index: true },
  tokenName: { type: String, default: '' },
  taskType: { type: String, required: true },  // 'daily', 'batch', 'single'
  taskName: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'running', 'success', 'failed', 'cancelled'], default: 'pending' },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  logs: [{ time: Date, message: String, level: { type: String, default: 'info' } }],
  error: { type: String, default: '' },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
}, { timestamps: true });

taskLogSchema.index({ userId: 1, createdAt: -1 });
taskLogSchema.index({ tokenId: 1, createdAt: -1 });

module.exports = mongoose.model('TaskLog', taskLogSchema);
