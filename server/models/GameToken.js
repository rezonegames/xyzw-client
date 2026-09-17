const mongoose = require('mongoose');

const gameTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  token: { type: String, required: true },
  wsUrl: { type: String, default: null },
  server: { type: String, default: '' },
  remark: { type: String, default: '' },
  importMethod: { type: String, enum: ['manual', 'bin', 'url', 'wxQrcode'], default: 'manual' },
  sourceUrl: { type: String, default: '' },
  avatar: { type: String, default: '' },
  level: { type: Number, default: 0 },
  profession: { type: String, default: '' },
  roleId: { type: String, default: '' },
  binData: { type: Buffer, default: null },  // 原始 bin 数据，用于 token 刷新
  isActive: { type: Boolean, default: true },
  lastUsed: { type: Date, default: null },
  // 日常任务设置
  dailySettings: { type: mongoose.Schema.Types.Mixed, default: {} },
  // 日常任务状态
  dailyTaskStatus: {
    lastRunDate: { type: String, default: '' },
    lastRunResult: { type: String, default: '' },
    isRunning: { type: Boolean, default: false },
  },
  // 连接状态持久化
  connectionState: {
    shouldConnect: { type: Boolean, default: false },
    autoPushLevel: { type: Boolean, default: false },  // 重启后自动推图
    pushLevelOpts: { type: mongoose.Schema.Types.Mixed, default: {} },  // 推图参数 {maxRetries, autoContinue}
  },
}, { timestamps: true });

gameTokenSchema.index({ userId: 1, roleId: 1 }, { unique: true, sparse: true });

// toJSON 时隐藏敏感数据
gameTokenSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    // binData 太大，列表接口不返回
    if (ret.binData) ret.hasBinData = true;
    delete ret.binData;
    return ret;
  }
});

module.exports = mongoose.model('GameToken', gameTokenSchema);
