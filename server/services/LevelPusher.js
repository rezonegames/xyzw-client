/**
 * LevelPusher — 后端主线推关服务
 * 从前端 PushingLevels.vue 移植，关闭浏览器后推关不停止
 * 通过 ConnectionManager.sendCommand 发送游戏命令
 */

const connectionManager = require('./ConnectionManager');
const logger = require('../utils/logger');
const GameToken = require('../models/GameToken');

const KNOWLEDGE_COIN_ITEM_ID = 1024;
const TORCH_REFRESH_INTERVAL = 30000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function pickNumber(...values) {
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function responseBody(resp) {
  if (resp?.body && typeof resp.body === 'object') return resp.body;
  return resp || {};
}

class LevelPusher {
  constructor() {
    /** @type {Map<string, object>} tokenId → running state */
    this.states = new Map();
  }

  /**
   * 启动某个 token 的推关
   * @param {string} tokenId
   * @param {object} opts - { maxRetries, autoContinue }
   * @returns {object} 初始状态
   */
  async start(tokenId, opts = {}) {
    if (this.states.has(tokenId) && this.states.get(tokenId).running) {
      return { error: '该账号已在推图中' };
    }

    const state = this._initState(tokenId, opts);
    this.states.set(tokenId, state);

    // 写入 DB 标记：autoPushLevel = true，记录推图参数
    await this._markPushLevel(tokenId, true, {
      maxRetries: state.maxRetries,
      autoContinue: state.autoContinue,
    });

    logger.info('LevelPush', `开始推图: ${tokenId}`, { maxRetries: state.maxRetries });

    // 异步执行，不阻塞返回
    this._run(tokenId, state).catch(err => {
      logger.error('LevelPush', `推图异常退出 [${tokenId}]: ${err.message}`);
    });

    return { status: 'started', tokenId };
  }

  /**
   * 停止推关
   */
  stop(tokenId) {
    const state = this.states.get(tokenId);
    if (!state) return { status: 'not_running' };
    state.stopFlag = true;
    // 手动停止时立即清除 DB 标记
    this._markPushLevel(tokenId, false).catch(() => {});
    logger.info('LevelPush', `手动停止推图: ${tokenId}`);
    return { status: 'stopping' };
  }

  /**
   * 获取某个 token 的推关状态
   */
  getStatus(tokenId) {
    const state = this.states.get(tokenId);
    if (!state) return { running: false };
    return this._serializeState(state);
  }

  /**
   * 获取所有正在推关的状态
   */
  getAllStatus() {
    const result = {};
    for (const [tokenId, state] of this.states) {
      result[tokenId] = this._serializeState(state);
    }
    return result;
  }

  /**
   * 使用火把
   */
  async useTorch(tokenId, itemId, quantity) {
    try {
      await connectionManager.sendCommand(tokenId, 'item_consume', { itemId, quantity }, 10000);
      // 查询最新火把状态
      const roleInfo = await connectionManager.sendCommand(tokenId, 'role_getroleinfo', {}, 10000);
      const torchInfo = this._readTorchFromResponse(roleInfo);
      const state = this.states.get(tokenId);
      if (state) this._applyTorchInfo(state, torchInfo);
      logger.info('LevelPush', `使用火把成功 [${tokenId}]: itemId=${itemId} qty=${quantity}`);
      return { success: true, torch: torchInfo };
    } catch (err) {
      logger.error('LevelPush', `使用火把失败 [${tokenId}]: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * 服务器重启后恢复推图（由 app.js 在 restoreConnections 之后调用）
   */
  async restorePushingLevels() {
    try {
      const tokens = await GameToken.find({ 'connectionState.autoPushLevel': true });
      if (!tokens.length) return;
      console.log(`[LevelPush] 恢复 ${tokens.length} 个推图任务...`);
      logger.info('LevelPush', `恢复 ${tokens.length} 个推图任务...`);

      for (const token of tokens) {
        const tokenId = token._id.toString();
        try {
          // 等待连接建立
          const waitStart = Date.now();
          while (Date.now() - waitStart < 10000) {
            const status = connectionManager.getStatus(tokenId);
            if (status.connected) break;
            await sleep(1000);
          }
          if (!connectionManager.getStatus(tokenId).connected) {
            logger.warn('LevelPush', `恢复推图跳过 ${token.name}: 连接未建立`);
            await this._markPushLevel(tokenId, false);
            continue;
          }

          const opts = token.connectionState?.pushLevelOpts || {};
          const result = await this.start(tokenId, opts);
          if (result.error) {
            logger.warn('LevelPush', `恢复推图失败 ${token.name}: ${result.error}`);
          } else {
            logger.info('LevelPush', `恢复推图成功: ${token.name}`);
          }
        } catch (err) {
          logger.error('LevelPush', `恢复推图异常 ${token.name}: ${err.message}`);
          await this._markPushLevel(tokenId, false).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[LevelPush] 恢复推图出错:', err.message);
      logger.error('LevelPush', `恢复推图出错: ${err.message}`);
    }
  }

  /**
   * 写入/清除 DB 推图标记
   */
  async _markPushLevel(tokenId, active, opts = null) {
    const mongoose = require('mongoose');
    const update = {
      'connectionState.autoPushLevel': active,
    };
    if (active && opts) {
      update['connectionState.pushLevelOpts'] = opts;
    }
    if (!active) {
      update['connectionState.pushLevelOpts'] = {};
    }
    try {
      if (mongoose.Types.ObjectId.isValid(tokenId)) {
        await GameToken.updateOne({ _id: tokenId }, { $set: update });
      } else {
        await GameToken.updateOne({ roleId: tokenId }, { $set: update });
      }
    } catch (err) {
      logger.warn('LevelPush', `更新推图标记失败 [${tokenId}]: ${err.message}`);
    }
  }

  // ─────────── 内部方法 ───────────

  _initState(tokenId, opts = {}) {
    return {
      tokenId,
      running: true,
      stopFlag: false,
      level: 0,
      bossName: '',
      bossLevel: 0,
      wins: 0,
      losses: 0,
      retries: 0,
      maxRetries: opts.maxRetries || 999999,
      autoContinue: opts.autoContinue !== false,
      battles: 0,
      countdown: 0,
      totalTime: 0,
      lastError: '',
      startTime: Date.now(),
      consecutiveErrors: 0,
      maxConsecutiveErrors: 5,
      logs: [],
      // 火把
      torchType: 0,
      torchTypeName: '',
      torchRemaining: 0,
      torchSettleTime: 0,
      torchActive: false,
      lastTorchFetch: 0,
    };
  }

  _serializeState(s) {
    return {
      tokenId: s.tokenId,
      running: s.running,
      stopFlag: s.stopFlag,
      level: s.level,
      bossName: s.bossName,
      wins: s.wins,
      losses: s.losses,
      retries: s.retries,
      battles: s.battles,
      countdown: s.countdown,
      totalTime: s.totalTime,
      lastError: s.lastError,
      startTime: s.startTime,
      elapsed: Math.round((Date.now() - s.startTime) / 1000),
      torchType: s.torchType,
      torchTypeName: s.torchTypeName,
      torchRemaining: s.torchRemaining,
      torchActive: s.torchActive,
      logs: s.logs.slice(-30),
    };
  }

  _addLog(state, msg, level = 'info') {
    const entry = { time: new Date().toISOString(), msg, level };
    state.logs.push(entry);
    if (state.logs.length > 200) state.logs.splice(0, state.logs.length - 200);

    // 写入文件日志
    const prefix = `[${state.tokenId.slice(0, 8)}]`;
    if (level === 'error') {
      logger.error('LevelPush', `${prefix} ${msg}`);
    } else {
      logger.info('LevelPush', `${prefix} ${msg}`);
    }

    // SSE 推送
    connectionManager.pushEventByToken(state.tokenId, 'levelPushLog', {
      tokenId: state.tokenId,
      msg, level,
      state: this._serializeState(state),
    });
  }

  async _run(tokenId, state) {
    try {
      // 1. 初始化战斗数据
      await this._initBattleData(tokenId, state);

      // 2. 获取当前关卡
      await this._fetchCurrentLevel(tokenId, state);

      // 3. 查询火把
      await this._fetchTorchInfo(tokenId, state);

      // 4. 推关主循环
      while (state.running && !state.stopFlag) {
        // 周期性刷新火把
        if (Date.now() - state.lastTorchFetch > TORCH_REFRESH_INTERVAL) {
          this._fetchTorchInfo(tokenId, state).catch(() => {});
        }

        const result = await this._runOneBattle(tokenId, state);
        if (result.stopped) break;
        if (state.stopFlag) break;

        if (!result.success) {
          if (state.retries >= state.maxRetries) break;
          await sleep(3000);
        } else if (!state.autoContinue) {
          this._addLog(state, '自动继续已关闭，推图暂停', 'warning');
          state.stopFlag = true;
          break;
        }

        await sleep(2000);
      }
    } catch (err) {
      this._addLog(state, `推图异常: ${err.message}`, 'error');
    } finally {
      state.running = false;
      state.countdown = 0;
      const elapsed = Math.round((Date.now() - state.startTime) / 1000);
      this._addLog(state, `推图结束: ${state.wins}胜 ${state.losses}败，共 ${state.battles} 场，耗时 ${elapsed}s`);
      logger.taskEnd(tokenId, '主线推关', state.wins > 0 ? 'success' : 'stopped', Date.now() - state.startTime);
      // 清除 DB 推图标记
      await this._markPushLevel(tokenId, false).catch(() => {});
      // 推完后再查一次火把
      this._fetchTorchInfo(tokenId, state).catch(() => {});
    }
  }

  async _initBattleData(tokenId, state) {
    try {
      await connectionManager.sendCommand(tokenId, 'role_getroleinfo', {}, 10000);
      const resp = await connectionManager.sendCommand(tokenId, 'fight_startlevel', {}, 10000);
      const body = responseBody(resp);
      const version = body?.battleData?.version || body?.body?.battleData?.version;
      if (version) {
        // 存到 gameDataCache
        connectionManager.updateGameData(tokenId, 'battleVersion', version);
        this._addLog(state, `battleVersion: ${version}`);
      }
    } catch (err) {
      this._addLog(state, `初始化战斗数据失败: ${err.message}`, 'warning');
    }
  }

  async _fetchCurrentLevel(tokenId, state) {
    try {
      const roleInfo = await connectionManager.sendCommand(tokenId, 'role_getroleinfo', {}, 10000);
      const body = responseBody(roleInfo);
      const level = pickNumber(body.levelId, body?.body?.levelId, body.currLevel);
      if (level !== null) {
        state.level = level;
        this._addLog(state, `当前关卡: ${level}`);
      }
    } catch (err) {
      this._addLog(state, `获取当前关卡失败: ${err.message}`, 'warning');
    }
  }

  async _fetchTorchInfo(tokenId, state) {
    try {
      const roleInfo = await connectionManager.sendCommand(tokenId, 'role_getroleinfo', {}, 10000);
      const info = this._readTorchFromResponse(roleInfo);
      this._applyTorchInfo(state, info);
      state.lastTorchFetch = Date.now();
    } catch (err) {
      // 静默
    }
  }

  async _upgradeHangupReward(tokenId, state) {
    try {
      const roleInfo = await connectionManager.sendCommand(tokenId, 'role_getroleinfo', {}, 5000);
      const body = responseBody(roleInfo);
      const items = body?.role?.items || body?.body?.role?.items || body?.items || [];
      let coinCount = 0;

      if (Array.isArray(items)) {
        const coin = items.find(e => Number(e.id ?? e.itemId) === KNOWLEDGE_COIN_ITEM_ID);
        coinCount = Number(coin?.num ?? coin?.count ?? coin?.quantity ?? 0);
      } else if (items && typeof items === 'object') {
        coinCount = Number(items[KNOWLEDGE_COIN_ITEM_ID]?.num ?? items[KNOWLEDGE_COIN_ITEM_ID] ?? 0);
      }

      if (coinCount <= 0) {
        this._addLog(state, '知识币不足，跳过升级挂机');
        return;
      }

      this._addLog(state, `知识币: ${coinCount}，开始升级挂机`);
      let used = 0;
      while (coinCount > 0 && !state.stopFlag) {
        const upgradeNum = coinCount >= 50 ? 50 : coinCount >= 10 ? 10 : 1;
        try {
          await connectionManager.sendCommand(tokenId, 'system_hangupupgrade', { upgradeNum }, 5000);
          coinCount -= upgradeNum;
          used += upgradeNum;
        } catch (err) {
          this._addLog(state, `升级挂机失败: ${err.message}`, 'warning');
          break;
        }
        await sleep(1200);
      }
      if (used > 0) {
        this._addLog(state, `升级挂机完成，共用 ${used} 知识币`);
      }
    } catch (err) {
      this._addLog(state, `升级挂机异常: ${err.message}`, 'warning');
    }
  }

  async _runOneBattle(tokenId, state) {
    if (state.stopFlag) return { stopped: true };

    // ── 阶段一：计算战斗时间 ──
    let battleTime = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await connectionManager.sendCommand(tokenId, 'fight_calcleveltime', {}, 15000);
        const body = responseBody(resp);
        battleTime = pickNumber(body.battleTime, body?.body?.battleTime) || 0;

        const syncedLevel = pickNumber(body.currLevel, body.levelId, body?.body?.currLevel);
        if (syncedLevel !== null && syncedLevel !== state.level) {
          state.level = syncedLevel;
          this._addLog(state, `等级同步: ${syncedLevel}`);
        }

        if (battleTime > 0) break;

        state.losses++;
        state.retries++;
        state.lastError = '服务器未返回战斗时间';
        this._addLog(state, `未返回有效战斗时间，重试 ${state.retries}`, 'warning');
      } catch (err) {
        state.losses++;
        state.retries++;
        state.lastError = err.message;
        this._addLog(state, `计算战斗时间失败: ${err.message}`, 'error');
        return { success: false, error: err.message };
      }
    }

    if (battleTime <= 0) {
      if (state.retries >= state.maxRetries) state.stopFlag = true;
      return { success: false, error: state.lastError };
    }

    // ── 阶段二：等待战斗 ──
    state.totalTime = battleTime;
    state.countdown = battleTime;
    state.battles++;
    this._addLog(state, `开始关卡 ${state.level || 0}，预计 ${battleTime}s`);

    // 逢百关自动升级挂机
    if (state.level > 0 && state.level % 100 === 1) {
      this._addLog(state, `通过逢100关 ${state.level - 1}，自动升级挂机`);
      await this._upgradeHangupReward(tokenId, state);
    }

    // 等待战斗时间（服务端 sleep，每 25 秒发心跳）
    const startedAt = Date.now();
    let tick = 0;
    while (state.countdown > 0 && !state.stopFlag) {
      await sleep(1000);
      tick++;
      state.countdown = Math.max(0, Math.ceil((battleTime * 1000 - (Date.now() - startedAt)) / 1000));
      if (tick % 25 === 0) {
        try {
          connectionManager.getClient(tokenId)?.sendHeartbeat?.();
        } catch {}
      }
      // 每 5 秒推送一次状态
      if (tick % 5 === 0) {
        connectionManager.pushEventByToken(tokenId, 'levelPushStatus', {
          tokenId, state: this._serializeState(state),
        });
      }
    }

    if (state.stopFlag) return { stopped: true };

    // ── 阶段三：结算战斗 ──
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await connectionManager.sendCommand(tokenId, 'fight_level', {}, 15000);
        const body = responseBody(resp);
        const success = Boolean(body.success || body.isWin);
        const nextLevel = pickNumber(body.currLevel, body.nextLevel, body.levelId);

        if (success) {
          state.wins++;
          state.retries = 0;
          state.consecutiveErrors = 0;
          state.level = nextLevel || state.level + 1;
          this._addLog(state, `胜利，当前关卡 ${state.level}`);
          this._fetchTorchInfo(tokenId, state).catch(() => {});
          return { success: true };
        }

        state.losses++;
        state.retries++;
        state.lastError = body.code || body.msg || '服务器判定失败';
        if (state.retries >= state.maxRetries) {
          state.stopFlag = true;
          this._addLog(state, `连续失败 ${state.retries} 次，停止`, 'error');
        } else {
          this._addLog(state, `失败，重试 ${state.retries}`, 'warning');
        }
        return { success: false, error: state.lastError };
      } catch (err) {
        state.losses++;
        state.retries++;
        state.consecutiveErrors++;
        state.lastError = err.message;

        if (state.consecutiveErrors >= state.maxConsecutiveErrors) {
          this._addLog(state, `连续异常 ${state.consecutiveErrors} 次`, 'error');
          state.consecutiveErrors = 0;
          if (attempt === 0) continue;
        }

        if (state.retries >= state.maxRetries) {
          state.stopFlag = true;
          this._addLog(state, `连续失败 ${state.retries} 次，停止`, 'error');
        }
        return { success: false, error: err.message };
      }
    }

    return { success: false, error: '未知战斗异常' };
  }

  _readTorchFromResponse(resp) {
    const body = responseBody(resp);
    const role = body.role || body?.body?.role || {};
    return {
      torchType: pickNumber(role.autoClickType, body.autoClickType) || 0,
      torchRemaining: pickNumber(role.autoClickTime, body.autoClickTime) || 0,
      torchSettleTime: pickNumber(role.autoClickSettleTime, body.autoClickSettleTime) || 0,
    };
  }

  _applyTorchInfo(state, info) {
    if (!state || !info) return;
    const TORCH_NAMES = { 1008: '木材火把', 1009: '青铜火把', 1010: '咸神火把' };
    state.torchType = Number(info.torchType || 0);
    state.torchTypeName = TORCH_NAMES[state.torchType] || '';
    state.torchRemaining = Number(info.torchRemaining || 0);
    state.torchSettleTime = Number(info.torchSettleTime || 0);
    state.torchActive = state.torchType > 0 && state.torchRemaining > 0;
  }
}

module.exports = new LevelPusher();
