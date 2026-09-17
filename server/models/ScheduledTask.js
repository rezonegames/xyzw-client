const mongoose = require('mongoose');

const scheduledTaskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  // 运行类型: daily=每天固定时间, cron=Cron表达式
  runType: { type: String, enum: ['daily', 'cron'], default: 'daily' },
  // daily 模式: HH:mm 格式
  runTime: { type: String, default: '' },
  // cron 模式: 标准 cron 表达式
  cronExpression: { type: String, default: '' },
  // 选中的 tokenIds
  selectedTokens: [{ type: String }],
  // 选中的任务函数名列表
  selectedTasks: [{ type: String }],
  // 每个 token 的任务设置
  tokenSettings: { type: mongoose.Schema.Types.Mixed, default: {} },
  // 执行状态
  lastRunAt: { type: Date, default: null },
  lastRunStatus: { type: String, enum: ['success', 'failed', 'partial', ''], default: '' },
  nextRunAt: { type: Date, default: null },
  runCount: { type: Number, default: 0 },
}, { timestamps: true });

scheduledTaskSchema.index({ userId: 1, enabled: 1 });
scheduledTaskSchema.index({ enabled: 1, nextRunAt: 1 });

module.exports = mongoose.model('ScheduledTask', scheduledTaskSchema);
