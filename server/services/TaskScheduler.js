/**
 * TaskScheduler — 后端定时任务调度器
 * 每 30 秒检查一次是否有到期任务，到期后调用 TaskRunner 执行
 * 定时任务存储在 MongoDB，服务器重启后自动恢复
 */

const ScheduledTask = require('../models/ScheduledTask');
const taskRunner = require('./TaskRunner');
const logger = require('../utils/logger');

const POLL_INTERVAL = 30 * 1000; // 30 秒检查一次

class TaskScheduler {
  constructor() {
    this.timer = null;
    this.executing = new Set(); // 正在执行的任务 ID，防止重复触发
  }

  /**
   * 启动调度器
   */
  start() {
    if (this.timer) return;
    console.log('[TaskScheduler] 定时任务调度器已启动');
    logger.info('TaskScheduler', '定时任务调度器已启动');

    // 启动时重新计算所有任务的 nextRunAt
    this._recalcAllNextRun().catch(() => {});

    this.timer = setInterval(() => this._tick(), POLL_INTERVAL);
    // 首次立即检查
    setTimeout(() => this._tick(), 5000);
  }

  /**
   * 停止调度器
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[TaskScheduler] 定时任务调度器已停止');
  }

  /**
   * 手动触发一个定时任务
   */
  async executeNow(taskId, userId) {
    const task = await ScheduledTask.findOne({ _id: taskId, userId });
    if (!task) throw new Error('定时任务不存在');
    return this._executeTask(task);
  }

  // ─────────── 内部方法 ───────────

  async _tick() {
    try {
      const now = new Date();
      const dueTasks = await ScheduledTask.find({
        enabled: true,
        nextRunAt: { $lte: now },
      });

      for (const task of dueTasks) {
        if (this.executing.has(task._id.toString())) continue;
        // 异步执行，不阻塞轮询
        this._executeTask(task).catch(err => {
          logger.error('TaskScheduler', `执行定时任务失败 [${task.name}]: ${err.message}`);
        });
      }
    } catch (err) {
      logger.error('TaskScheduler', `调度轮询异常: ${err.message}`);
    }
  }

  async _executeTask(task) {
    const taskId = task._id.toString();
    if (this.executing.has(taskId)) {
      throw new Error('任务正在执行中');
    }

    this.executing.add(taskId);
    logger.info('TaskScheduler', `开始执行定时任务: ${task.name} (${task.selectedTokens.length} 个账号)`);

    let successCount = 0;
    let failCount = 0;

    try {
      // 对每个 token 依次执行日常任务
      for (const tokenId of task.selectedTokens) {
        try {
          // 获取该 token 的设置
          const settings = task.tokenSettings?.[tokenId] || {};
          const taskLog = await taskRunner.runDailyTasks(tokenId, task.userId.toString(), settings);

          // 等待该 token 任务完成（最长 10 分钟）
          const waitStart = Date.now();
          const maxWait = 10 * 60 * 1000;
          while (Date.now() - waitStart < maxWait) {
            const running = taskRunner.getRunningTask(tokenId);
            if (!running) break;
            await new Promise(r => setTimeout(r, 3000));
          }

          // 检查结果
          const running = taskRunner.getRunningTask(tokenId);
          if (running) {
            // 超时，取消
            taskRunner.cancel(tokenId);
            failCount++;
          } else {
            successCount++;
          }
        } catch (err) {
          logger.error('TaskScheduler', `定时任务 ${task.name} - token ${tokenId} 失败: ${err.message}`);
          failCount++;
        }

        // token 之间间隔 2 秒
        await new Promise(r => setTimeout(r, 2000));
      }

      // 更新任务状态
      const status = failCount === 0 ? 'success' : successCount === 0 ? 'failed' : 'partial';
      await ScheduledTask.updateOne({ _id: taskId }, {
        $set: {
          lastRunAt: new Date(),
          lastRunStatus: status,
          nextRunAt: this._calcNextRun(task),
        },
        $inc: { runCount: 1 },
      });

      logger.info('TaskScheduler', `定时任务完成: ${task.name} — 成功 ${successCount}，失败 ${failCount}`);
      return { success: successCount, failed: failCount, status };
    } finally {
      this.executing.delete(taskId);
    }
  }

  /**
   * 重新计算所有启用任务的 nextRunAt
   */
  async _recalcAllNextRun() {
    try {
      const tasks = await ScheduledTask.find({ enabled: true });
      for (const task of tasks) {
        const nextRun = this._calcNextRun(task);
        if (nextRun) {
          await ScheduledTask.updateOne({ _id: task._id }, { $set: { nextRunAt: nextRun } });
        }
      }
      logger.info('TaskScheduler', `已重新计算 ${tasks.length} 个定时任务的下次执行时间`);
    } catch (err) {
      logger.error('TaskScheduler', `重新计算 nextRunAt 失败: ${err.message}`);
    }
  }

  /**
   * 计算下次执行时间
   */
  _calcNextRun(task) {
    const now = new Date();

    if (task.runType === 'daily' && task.runTime) {
      const [hours, minutes] = task.runTime.split(':').map(Number);
      const next = new Date(now);
      next.setHours(hours, minutes, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      return next;
    }

    if (task.runType === 'cron' && task.cronExpression) {
      return this._calcNextCronRun(task.cronExpression, now);
    }

    return null;
  }

  /**
   * 简易 cron 解析：支持 "分 时 日 月 周" 五段格式
   */
  _calcNextCronRun(expression, from) {
    try {
      const parts = expression.trim().split(/\s+/);
      if (parts.length !== 5) return null;

      const [minExpr, hourExpr] = parts;
      const minutes = this._parseCronField(minExpr, 0, 59);
      const hours = this._parseCronField(hourExpr, 0, 23);

      if (!minutes.length || !hours.length) return null;

      // 尝试未来 48 小时内找到下一个匹配时间
      const candidate = new Date(from);
      candidate.setSeconds(0, 0);
      candidate.setMinutes(candidate.getMinutes() + 1);

      for (let i = 0; i < 48 * 60; i++) {
        if (hours.includes(candidate.getHours()) && minutes.includes(candidate.getMinutes())) {
          return candidate;
        }
        candidate.setMinutes(candidate.getMinutes() + 1);
      }
      return null;
    } catch {
      return null;
    }
  }

  _parseCronField(field, min, max) {
    if (field === '*') {
      return Array.from({ length: max - min + 1 }, (_, i) => i + min);
    }
    const values = new Set();
    for (const part of field.split(',')) {
      if (part.includes('/')) {
        const [range, step] = part.split('/');
        const s = parseInt(step);
        const start = range === '*' ? min : parseInt(range);
        for (let i = start; i <= max; i += s) values.add(i);
      } else if (part.includes('-')) {
        const [a, b] = part.split('-').map(Number);
        for (let i = a; i <= b; i++) values.add(i);
      } else {
        const n = parseInt(part);
        if (!isNaN(n) && n >= min && n <= max) values.add(n);
      }
    }
    return Array.from(values).sort((a, b) => a - b);
  }
}

module.exports = new TaskScheduler();
