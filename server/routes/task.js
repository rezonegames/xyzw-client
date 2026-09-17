/**
 * 任务管理 API 路由
 * 挂载路径: /api/v1/tasks
 */

const express = require('express');
const auth = require('../middleware/auth');
const taskRunner = require('../services/TaskRunner');
const taskScheduler = require('../services/TaskScheduler');
const TaskLog = require('../models/TaskLog');
const ScheduledTask = require('../models/ScheduledTask');

const router = express.Router();

// POST /api/v1/tasks/daily/:tokenId — 启动每日任务
router.post('/daily/:tokenId', auth, async (req, res) => {
  try {
    const taskLog = await taskRunner.runDailyTasks(
      req.params.tokenId,
      req.userId,
      req.body.settings || {},
    );
    res.json({ success: true, data: { taskId: taskLog._id, status: 'running' } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/v1/tasks/:tokenId/cancel — 取消正在运行的任务
router.post('/:tokenId/cancel', auth, (req, res) => {
  const ok = taskRunner.cancel(req.params.tokenId);
  res.json({ success: true, data: { cancelled: ok } });
});

// GET /api/v1/tasks/:tokenId/status — 获取当前任务状态（优先返回运行中的，否则查 DB 最新记录）
router.get('/:tokenId/status', auth, async (req, res) => {
  try {
    const running = taskRunner.getRunningTask(req.params.tokenId);
    if (running) {
      return res.json({
        success: true,
        data: {
          status: 'running',
          progress: running.taskLog.progress,
          logs: running.taskLog.logs.slice(-20),
        },
      });
    }

    // 查 DB 最新记录
    const latest = await TaskLog.findOne({ tokenId: req.params.tokenId }).sort({ createdAt: -1 });
    if (latest) {
      return res.json({
        success: true,
        data: {
          status: latest.status,
          progress: latest.progress,
          logs: latest.logs.slice(-20),
          finishedAt: latest.finishedAt,
        },
      });
    }

    res.json({ success: true, data: { status: 'none' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/v1/tasks/history — 获取任务执行历史（分页）
router.get('/history', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      TaskLog.find({ userId: req.userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      TaskLog.countDocuments({ userId: req.userId }),
    ]);

    res.json({ success: true, data: { items, total, page, limit } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/v1/tasks/:taskId/logs — 获取任务完整日志
router.get('/:taskId/logs', auth, async (req, res) => {
  try {
    const log = await TaskLog.findOne({ _id: req.params.taskId, userId: req.userId });
    if (!log) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: log });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ────────────── 定时任务 CRUD ──────────────

// GET /api/v1/tasks/scheduled — 获取用户的所有定时任务
router.get('/scheduled', auth, async (req, res) => {
  try {
    const tasks = await ScheduledTask.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/tasks/scheduled — 创建定时任务
router.post('/scheduled', auth, async (req, res) => {
  try {
    const { name, runType, runTime, cronExpression, selectedTokens, selectedTasks, tokenSettings, enabled } = req.body;
    if (!name || !selectedTokens?.length || !selectedTasks?.length) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    const task = await ScheduledTask.create({
      userId: req.userId,
      name,
      runType: runType || 'daily',
      runTime: runTime || '',
      cronExpression: cronExpression || '',
      selectedTokens,
      selectedTasks,
      tokenSettings: tokenSettings || {},
      enabled: enabled !== false,
    });

    // 计算 nextRunAt
    const nextRun = taskScheduler._calcNextRun(task);
    if (nextRun) {
      await ScheduledTask.updateOne({ _id: task._id }, { $set: { nextRunAt: nextRun } });
      task.nextRunAt = nextRun;
    }

    res.json({ success: true, data: task });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/v1/tasks/scheduled/:id — 更新定时任务
router.put('/scheduled/:id', auth, async (req, res) => {
  try {
    const task = await ScheduledTask.findOne({ _id: req.params.id, userId: req.userId });
    if (!task) return res.status(404).json({ success: false, message: '定时任务不存在' });

    const { name, runType, runTime, cronExpression, selectedTokens, selectedTasks, tokenSettings, enabled } = req.body;

    if (name !== undefined) task.name = name;
    if (runType !== undefined) task.runType = runType;
    if (runTime !== undefined) task.runTime = runTime;
    if (cronExpression !== undefined) task.cronExpression = cronExpression;
    if (selectedTokens !== undefined) task.selectedTokens = selectedTokens;
    if (selectedTasks !== undefined) task.selectedTasks = selectedTasks;
    if (tokenSettings !== undefined) task.tokenSettings = tokenSettings;
    if (enabled !== undefined) task.enabled = enabled;

    // 重新计算 nextRunAt
    task.nextRunAt = taskScheduler._calcNextRun(task);
    await task.save();

    res.json({ success: true, data: task });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/v1/tasks/scheduled/:id — 删除定时任务
router.delete('/scheduled/:id', auth, async (req, res) => {
  try {
    const result = await ScheduledTask.deleteOne({ _id: req.params.id, userId: req.userId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: '定时任务不存在' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/tasks/scheduled/:id/toggle — 启用/禁用定时任务
router.post('/scheduled/:id/toggle', auth, async (req, res) => {
  try {
    const task = await ScheduledTask.findOne({ _id: req.params.id, userId: req.userId });
    if (!task) return res.status(404).json({ success: false, message: '定时任务不存在' });

    task.enabled = !task.enabled;
    if (task.enabled) {
      task.nextRunAt = taskScheduler._calcNextRun(task);
    }
    await task.save();

    res.json({ success: true, data: { enabled: task.enabled, nextRunAt: task.nextRunAt } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/v1/tasks/scheduled/:id/execute — 立即执行定时任务
router.post('/scheduled/:id/execute', auth, async (req, res) => {
  try {
    const result = await taskScheduler.executeNow(req.params.id, req.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
