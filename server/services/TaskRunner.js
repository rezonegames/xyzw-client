/**
 * TaskRunner — 服务端每日任务执行器
 * 从前端 dailyTaskRunner.js 移植，使用 ConnectionManager.sendCommand 代替 tokenStore
 */

const connectionManager = require('./ConnectionManager');
const TaskLog = require('../models/TaskLog');
const GameToken = require('../models/GameToken');
const logger = require('../utils/logger');

const DAY_BOSS_MAP = [9904, 9905, 9901, 9902, 9903, 9904, 9905]; // 周日~周六
const getTodayBossId = () => DAY_BOSS_MAP[new Date().getDay()];

const isTodayAvailable = (statisticsTime) => {
  if (!statisticsTime) return true;
  const today = new Date().toDateString();
  const recordDate = new Date(statisticsTime * 1000).toDateString();
  return today !== recordDate;
};

const pickArenaTargetId = (targets) => {
  if (!targets) return null;
  if (Array.isArray(targets)) {
    const c = targets[0];
    return c?.roleId || c?.id || c?.targetId;
  }
  const candidate =
    targets?.rankList?.[0] ||
    targets?.roleList?.[0] ||
    targets?.targets?.[0] ||
    targets?.targetList?.[0] ||
    targets?.list?.[0];
  if (candidate) {
    if (candidate.roleId) return candidate.roleId;
    if (candidate.id) return candidate.id;
    if (candidate.targetId) return candidate.targetId;
  }
  return targets?.roleId || targets?.id || targets?.targetId;
};

class TaskRunner {
  constructor() {
    /** @type {Map<string, { taskLog: object, cancelled: boolean }>} */
    this.runningTasks = new Map();
  }

  /**
   * 启动每日任务（异步执行，立即返回 taskLog）
   * @param {string} tokenId
   * @param {string} userId
   * @param {object} settings - 任务设置
   * @param {object} [connectOpts] - 连接参数 { token, wsUrl, name }，提供时自动建立临时连接
   * @returns {Promise<object>} taskLog document
   */
  async runDailyTasks(tokenId, userId, settings = {}, connectOpts = null) {
    const tokenIdStr = tokenId.toString();
    if (this.runningTasks.has(tokenIdStr)) {
      throw new Error('Task already running for this token');
    }

    const defaultSettings = {
      commandDelay: 500,
      taskDelay: 500,
      arenaFormation: 1,
      bossFormation: 1,
      bossTimes: 2,
      claimBottle: true,
      payRecruit: true,
      openBox: true,
      arenaEnable: true,
      claimHangUp: true,
      claimEmail: true,
      blackMarketPurchase: true,
      freeGachaEnable: true,
    };
    const s = { ...defaultSettings, ...settings };

    const taskLog = await TaskLog.create({
      userId,
      tokenId,
      taskType: 'daily',
      taskName: '每日任务',
      status: 'running',
      startedAt: new Date(),
    });

    const ctx = { taskLog, cancelled: false, selfConnected: false, connectOpts };
    this.runningTasks.set(tokenIdStr, ctx);

    // 异步执行，不阻塞返回
    this._executeDailyTasks(tokenIdStr, s, ctx).catch((err) => {
      console.error(`[TaskRunner] ${tokenIdStr} error:`, err.message);
      logger.error('TaskRunner', `${tokenIdStr} 执行异常: ${err.message}`);
    });

    return taskLog;
  }

  /**
   * 取消正在运行的任务
   * @param {string} tokenId
   * @returns {boolean}
   */
  cancel(tokenId) {
    const ctx = this.runningTasks.get(tokenId.toString());
    if (!ctx) return false;
    ctx.cancelled = true;
    return true;
  }

  /**
   * 获取正在运行的任务上下文
   * @param {string} tokenId
   * @returns {object|null}
   */
  getRunningTask(tokenId) {
    return this.runningTasks.get(tokenId.toString()) || null;
  }

  // ─────────── 内部方法 ───────────

  async _exec(tokenId, cmd, params, desc, ctx, timeout = 8000) {
    if (ctx.cancelled) throw new Error('Task cancelled');
    try {
      ctx.taskLog.logs.push({ time: new Date(), message: `执行: ${desc}`, level: 'info' });
      const result = await connectionManager.sendCommand(tokenId, cmd, params, timeout);
      ctx.taskLog.logs.push({ time: new Date(), message: `${desc} - 成功`, level: 'info' });
      return result;
    } catch (err) {
      ctx.taskLog.logs.push({ time: new Date(), message: `${desc} - 失败: ${err.message}`, level: 'error' });
      logger.taskStepFailed(tokenId, desc, err.message);
      throw err;
    }
  }

  /**
   * 通过 SSE 推送任务进度
   */
  _pushTaskProgress(tokenId, ctx) {
    connectionManager.pushEventByToken(tokenId, 'taskProgress', {
      status: ctx.taskLog.status,
      progress: ctx.taskLog.progress,
      taskName: ctx.taskLog.taskName,
      logs: ctx.taskLog.logs.slice(-5),
    });
  }

  /**
   * 确保连接存在：如果未连接，自动建立临时连接
   * 优先使用 connectOpts 参数，其次从 DB 查找 token 信息
   */
  async _ensureConnection(tokenId, ctx) {
    const status = connectionManager.getStatus(tokenId);
    if (status.connected) return; // 已连接，无需操作

    // 获取连接参数
    let connectParams = ctx.connectOpts || {};
    if (!connectParams.token) {
      // 从 DB 查找
      const mongoose = require('mongoose');
      let tokenDoc = null;
      try {
        if (mongoose.Types.ObjectId.isValid(tokenId)) {
          tokenDoc = await GameToken.findById(tokenId);
        }
        if (!tokenDoc) {
          tokenDoc = await GameToken.findOne({ roleId: tokenId });
        }
      } catch (e) { /* ignore */ }

      if (!tokenDoc?.token) {
        throw new Error('无法建立连接：未找到 token 信息');
      }
      connectParams = {
        token: tokenDoc.token,
        wsUrl: tokenDoc.wsUrl,
        name: tokenDoc.name,
      };
    }

    // 建立临时连接
    ctx.taskLog.logs.push({ time: new Date(), message: '正在建立临时连接...', level: 'info' });
    const userId = ctx.taskLog.userId?.toString();
    await connectionManager.connect(tokenId, userId, connectParams);

    // 等待连接建立（最多 10 秒）
    const waitStart = Date.now();
    while (Date.now() - waitStart < 10000) {
      if (connectionManager.getStatus(tokenId).connected) break;
      await new Promise(r => setTimeout(r, 500));
    }

    if (!connectionManager.getStatus(tokenId).connected) {
      throw new Error('临时连接超时，无法建立连接');
    }

    ctx.selfConnected = true;
    ctx.taskLog.logs.push({ time: new Date(), message: '临时连接已建立', level: 'info' });
  }

  async _switchFormation(tokenId, target, name, ctx) {
    const teamInfo = await this._exec(tokenId, 'presetteam_getinfo', {}, '获取阵容信息', ctx);
    const current = teamInfo?.presetTeamInfo?.useTeamId;
    if (current === target) return false;
    await this._exec(tokenId, 'presetteam_saveteam', { teamId: target }, `切换到${name}${target}`, ctx);
    return true;
  }

  async _executeDailyTasks(tokenId, s, ctx) {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const startTime = Date.now();
    logger.taskStart(tokenId, ctx.taskLog.taskName || '每日任务');

    try {
      // ── 自动连接：如果当前未连接，使用提供的参数或从 DB 查找 ──
      await this._ensureConnection(tokenId, ctx);

      // 获取角色信息
      const roleInfoResp = await this._exec(tokenId, 'role_getroleinfo', {}, '获取角色信息', ctx);
      const roleData = roleInfoResp?.role;
      if (!roleData) throw new Error('角色数据不存在');

      // 记录原始阵容
      let originalFormation = null;
      try {
        const teamInfo = await this._exec(tokenId, 'presetteam_getinfo', {}, '获取当前阵容', ctx);
        originalFormation = teamInfo?.presetTeamInfo?.useTeamId;
      } catch (e) { /* ignore */ }

      const completedTasks = roleData.dailyTask?.complete ?? {};
      const isTaskCompleted = (id) => completedTasks[id] === -1;
      const statistics = roleData.statistics ?? {};
      const statisticsTime = roleData.statisticsTime ?? {};

      const tasks = [];

      // ── 1. 基础任务 ──

      if (!isTaskCompleted(2)) {
        tasks.push({ n: '分享游戏', fn: () => this._exec(tokenId, 'system_mysharecallback', { isSkipShareCard: true, type: 2 }, '分享游戏', ctx) });
      }

      if (!isTaskCompleted(3)) {
        tasks.push({ n: '赠送好友金币', fn: () => this._exec(tokenId, 'friend_batch', {}, '赠送好友金币', ctx) });
      }

      if (!isTaskCompleted(4)) {
        tasks.push({ n: '免费招募', fn: () => this._exec(tokenId, 'hero_recruit', { recruitType: 3, recruitNumber: 1 }, '免费招募', ctx) });
        if (s.payRecruit) {
          tasks.push({ n: '付费招募', fn: () => this._exec(tokenId, 'hero_recruit', { recruitType: 1, recruitNumber: 1 }, '付费招募', ctx) });
        }
      }

      if (!isTaskCompleted(6) && isTodayAvailable(statisticsTime['buy:gold'])) {
        for (let i = 0; i < 3; i++) {
          tasks.push({ n: `免费点金${i + 1}`, fn: () => this._exec(tokenId, 'system_buygold', { buyNum: 1 }, `免费点金${i + 1}`, ctx) });
        }
      }

      if (!isTaskCompleted(5) && s.claimHangUp) {
        tasks.push({ n: '领取挂机奖励', fn: () => this._exec(tokenId, 'system_claimhangupreward', {}, '领取挂机奖励', ctx) });
        for (let i = 0; i < 4; i++) {
          tasks.push({ n: `挂机加钟${i + 1}`, fn: () => this._exec(tokenId, 'system_mysharecallback', { isSkipShareCard: true, type: 2 }, `挂机加钟${i + 1}`, ctx) });
        }
      }

      if (!isTaskCompleted(7) && s.openBox) {
        tasks.push({ n: '开启宝箱', fn: () => this._exec(tokenId, 'item_openbox', { itemId: 2001, number: 10 }, '开启宝箱', ctx) });
      }

      // 盐罐
      tasks.push({ n: '停止盐罐', fn: () => this._exec(tokenId, 'bottlehelper_stop', {}, '停止盐罐', ctx) });
      tasks.push({ n: '开始盐罐', fn: () => this._exec(tokenId, 'bottlehelper_start', {}, '开始盐罐', ctx) });
      if (!isTaskCompleted(14) && s.claimBottle) {
        tasks.push({ n: '领取盐罐', fn: () => this._exec(tokenId, 'bottlehelper_claim', {}, '领取盐罐', ctx) });
      }

      // ── 2. 竞技场 ──

      if (!isTaskCompleted(13) && s.arenaEnable) {
        tasks.push({
          n: '竞技场',
          fn: async () => {
            const hour = new Date().getHours();
            if (hour < 6 || hour > 22) return;
            await this._switchFormation(tokenId, s.arenaFormation, '竞技场阵容', ctx);
            await this._exec(tokenId, 'arena_startarea', {}, '开始竞技场', ctx);
            for (let i = 1; i <= 3; i++) {
              const targets = await this._exec(tokenId, 'arena_getareatarget', {}, `获取对手${i}`, ctx);
              const targetId = pickArenaTargetId(targets);
              if (targetId) {
                await this._exec(tokenId, 'fight_startareaarena', { targetId }, `竞技场战斗${i}`, ctx, 10000);
              }
              await delay(1000);
            }
          },
        });
      }

      // ── 3. BOSS ──

      if (s.bossTimes > 0) {
        let already = statistics['legion:boss'] ?? 0;
        if (isTodayAvailable(statisticsTime['legion:boss'])) already = 0;
        const remaining = Math.max(s.bossTimes - already, 0);
        if (remaining > 0) {
          tasks.push({ n: 'BOSS阵容', fn: () => this._switchFormation(tokenId, s.bossFormation, 'BOSS阵容', ctx) });
          for (let i = 0; i < remaining; i++) {
            tasks.push({ n: `军团BOSS${i + 1}`, fn: () => this._exec(tokenId, 'fight_startlegionboss', {}, `军团BOSS${i + 1}`, ctx, 12000) });
          }
        }
      }

      const bossId = getTodayBossId();
      tasks.push({ n: '每日BOSS阵容', fn: () => this._switchFormation(tokenId, s.bossFormation, 'BOSS阵容', ctx) });
      for (let i = 0; i < 3; i++) {
        tasks.push({ n: `每日BOSS${i + 1}`, fn: () => this._exec(tokenId, 'fight_startboss', { bossId }, `每日BOSS${i + 1}`, ctx, 12000) });
      }

      // ── 4. 固定奖励 ──

      const rewards = [
        { n: '福利签到', cmd: 'system_signinreward' },
        { n: '俱乐部签到', cmd: 'legion_signin' },
        { n: '每日礼包', cmd: 'discount_claimreward' },
        { n: '每日免费奖励', cmd: 'collection_claimfreereward' },
        { n: '免费礼包', cmd: 'card_claimreward' },
        { n: '永久卡礼包', cmd: 'card_claimreward', p: { cardId: 4003 } },
      ];
      if (s.claimEmail) {
        rewards.push({ n: '领取邮件', cmd: 'mail_claimallattachment' });
      }
      rewards.forEach((r) => {
        tasks.push({ n: r.n, fn: () => this._exec(tokenId, r.cmd, r.p || {}, r.n, ctx) });
      });

      tasks.push({ n: '珍宝阁列表', fn: () => this._exec(tokenId, 'collection_goodslist', {}, '珍宝阁列表', ctx) });
      tasks.push({ n: '珍宝阁免费', fn: () => this._exec(tokenId, 'collection_claimfreereward', {}, '珍宝阁免费', ctx) });

      // 免费扭蛋
      if (s.freeGachaEnable !== false && isTodayAvailable(statisticsTime['gacha:free'])) {
        tasks.push({ n: '免费扭蛋', fn: () => this._exec(tokenId, 'gacha_drawreward', { num: 1, isGroup: false }, '免费扭蛋', ctx) });
      }

      // ── 5. 免费活动 ──

      // 钓鱼
      if (isTodayAvailable(statistics['artifact:normal:lottery:time'])) {
        for (let i = 0; i < 3; i++) {
          tasks.push({ n: `免费钓鱼${i + 1}`, fn: () => this._exec(tokenId, 'artifact_lottery', { lotteryNumber: 1, newFree: true, type: 1 }, `免费钓鱼${i + 1}`, ctx) });
        }
      }

      // 灯神
      const kingdoms = ['魏国', '蜀国', '吴国', '群雄'];
      for (let gid = 1; gid <= 4; gid++) {
        if (isTodayAvailable(statisticsTime[`genie:daily:free:${gid}`])) {
          tasks.push({ n: `${kingdoms[gid - 1]}灯神`, fn: () => this._exec(tokenId, 'genie_sweep', { genieId: gid }, `${kingdoms[gid - 1]}灯神`, ctx) });
        }
      }
      for (let i = 0; i < 3; i++) {
        tasks.push({ n: `免费扫荡卷${i + 1}`, fn: () => this._exec(tokenId, 'genie_buysweep', {}, `免费扫荡卷${i + 1}`, ctx) });
      }

      // ── 6. 黑市 ──

      if (!isTaskCompleted(12) && s.blackMarketPurchase) {
        tasks.push({ n: '黑市购买', fn: () => this._exec(tokenId, 'store_purchase', { goodsId: 1 }, '黑市购买', ctx) });
      }

      // 咸王梦境
      const dow = new Date().getDay();
      if ([0, 1, 3, 4].includes(dow)) {
        tasks.push({ n: '咸王梦境', fn: () => this._exec(tokenId, 'dungeon_selecthero', { battleTeam: { 0: 107 } }, '咸王梦境', ctx) });
      }

      // 深海灯神
      if (dow === 1 && isTodayAvailable(statisticsTime['genie:daily:free:5'])) {
        tasks.push({ n: '深海灯神', fn: () => this._exec(tokenId, 'genie_sweep', { genieId: 5, sweepCnt: 1 }, '深海灯神', ctx) });
      }

      // ── 阵容还原 ──

      if (originalFormation) {
        tasks.push({ n: '阵容还原', fn: () => this._switchFormation(tokenId, originalFormation, '初始阵容', ctx) });
      }

      // ── 7. 任务奖励 ──

      for (let id = 1; id <= 10; id++) {
        tasks.push({ n: `任务奖励${id}`, fn: () => this._exec(tokenId, 'task_claimdailypoint', { taskId: id }, `任务奖励${id}`, ctx, 5000) });
      }
      tasks.push({ n: '日常任务奖励', fn: () => this._exec(tokenId, 'task_claimdailyreward', {}, '日常任务奖励', ctx) });
      tasks.push({ n: '周常任务奖励', fn: () => this._exec(tokenId, 'task_claimweekreward', {}, '周常任务奖励', ctx) });
      tasks.push({ n: '通行证奖励', fn: () => this._exec(tokenId, 'activity_recyclewarorderrewardclaim', { actId: 1 }, '通行证奖励', ctx) });

      // ── 执行所有任务 ──

      const total = tasks.length;
      for (let i = 0; i < total; i++) {
        if (ctx.cancelled) break;
        try {
          await tasks[i].fn();
          ctx.taskLog.progress = Math.floor(((i + 1) / total) * 100);
          await delay(s.taskDelay);
        } catch (err) {
          // 单个任务失败不中断，继续执行
        }
        // 每 5 个任务推送进度 + 保存日志
        if (i % 5 === 0) {
          this._pushTaskProgress(tokenId, ctx);
          await ctx.taskLog.save();
        }
      }

      ctx.taskLog.status = ctx.cancelled ? 'cancelled' : 'success';
      ctx.taskLog.progress = 100;
      ctx.taskLog.finishedAt = new Date();
      await ctx.taskLog.save();
      this._pushTaskProgress(tokenId, ctx);
    } catch (err) {
      ctx.taskLog.status = 'failed';
      ctx.taskLog.error = err.message;
      ctx.taskLog.finishedAt = new Date();
      await ctx.taskLog.save();
    } finally {
      logger.taskEnd(tokenId, ctx.taskLog.taskName || '每日任务', ctx.taskLog.status, Date.now() - startTime);
      // 自动断开：如果是 TaskRunner 自己建立的临时连接，任务完成后断开
      if (ctx.selfConnected) {
        try {
          await connectionManager.disconnect(tokenId);
          ctx.taskLog.logs.push({ time: new Date(), message: '临时连接已断开', level: 'info' });
          await ctx.taskLog.save();
        } catch (e) {
          logger.warn('TaskRunner', `断开临时连接失败 [${tokenId}]: ${e.message}`);
        }
      }
      this.runningTasks.delete(tokenId);
    }
  }
}

module.exports = new TaskRunner();
