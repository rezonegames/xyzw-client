/**
 * ConnectionManager — 管理所有到游戏服务器的 WebSocket 连接
 * 单例模式，通过 tokenId 索引连接
 * 支持：持久化连接状态、断线自动重连、服务器重启后自动恢复
 * v2: 增加游戏数据缓存 + SSE 事件推送
 */

const EventEmitter = require('events');
const { GameWebSocketClient } = require('../utils/GameWebSocket');
const { errorCodeMap, responseToCommandMap } = require('../utils/GameWebSocket');
const GameToken = require('../models/GameToken');
const logger = require('../utils/logger');

class ConnectionManager extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100); // SSE 客户端可能较多
    this.connections = new Map();
    // 游戏数据缓存: tokenId → { roleInfo, legionInfo, presetTeam, ... }
    this.gameDataCache = new Map();
    // SSE 客户端: userId → Set<res>
    this.sseClients = new Map();
  }

  // ─────────── SSE 管理 ───────────

  /**
   * 注册 SSE 客户端
   */
  addSSEClient(userId, res) {
    const uid = userId.toString();
    if (!this.sseClients.has(uid)) {
      this.sseClients.set(uid, new Set());
    }
    this.sseClients.get(uid).add(res);

    // 连接断开时自动移除
    res.on('close', () => {
      const clients = this.sseClients.get(uid);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) this.sseClients.delete(uid);
      }
    });
  }

  /**
   * 向指定用户的所有 SSE 客户端推送事件
   */
  pushEvent(userId, event, data) {
    const uid = userId.toString();
    const clients = this.sseClients.get(uid);
    if (!clients || clients.size === 0) return;

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch (e) {
        // 客户端已断开，清理
        clients.delete(res);
      }
    }
  }

  /**
   * 向指定 tokenId 对应的用户推送事件
   */
  pushEventByToken(tokenId, event, data) {
    const conn = this.connections.get(tokenId.toString());
    if (conn?.userId) {
      this.pushEvent(conn.userId, event, { tokenId: tokenId.toString(), ...data });
    }
  }

  // ─────────── 游戏数据缓存 ───────────

  /**
   * 获取缓存的游戏数据
   */
  getGameData(tokenId) {
    return this.gameDataCache.get(tokenId.toString()) || null;
  }

  /**
   * 更新游戏数据缓存
   */
  updateGameData(tokenId, key, value) {
    const id = tokenId.toString();
    if (!this.gameDataCache.has(id)) {
      this.gameDataCache.set(id, { lastUpdated: new Date().toISOString() });
    }
    const cache = this.gameDataCache.get(id);
    cache[key] = value;
    cache.lastUpdated = new Date().toISOString();
  }

  // ─────────── 游戏消息处理 ───────────

  /**
   * 处理来自游戏服务器的消息，缓存关键数据并推送给前端
   */
  _handleGameMessage(tokenId, packet) {
    try {
      const cmd = packet?.cmd?.toLowerCase?.() || packet?.cmd;
      if (!cmd) return;

      const body = packet?.decodedBody || packet?.rawData || packet?.body;

      // 缓存关键数据
      if (cmd === 'role_getroleinforesp') {
        this.updateGameData(tokenId, 'roleInfo', body);
        this.pushEventByToken(tokenId, 'roleInfo', { roleInfo: body });
      } else if (cmd === 'legion_getinforesp' || cmd === 'legion_getinforresp') {
        this.updateGameData(tokenId, 'legionInfo', body);
        this.pushEventByToken(tokenId, 'legionInfo', { legionInfo: body });
      } else if (cmd === 'presetteam_getinforesp') {
        this.updateGameData(tokenId, 'presetTeam', body);
      } else if (cmd === 'system_getdatabundleverresp') {
        if (body?.battleVersion !== undefined) {
          this.updateGameData(tokenId, 'battleVersion', body.battleVersion);
        }
      }

      // 推送通用游戏消息（前端可选监听）
      this.pushEventByToken(tokenId, 'gameMessage', {
        cmd,
        code: packet?.code,
        hasBody: !!body,
      });
    } catch (err) {
      console.error(`[ConnMgr] 处理游戏消息失败 [${tokenId}]:`, err.message);
      logger.error('ConnMgr', `处理游戏消息失败 [${tokenId}]: ${err.message}`);
    }
  }

  // ─────────── 连接管理 ───────────

  /**
   * 服务器启动时调用：只恢复 autoPushLevel 为 true 的连接（推图中的账号）
   * 普通连接不再自动恢复，避免服务器重启后占用大量无用连接
   */
  async restoreConnections() {
    try {
      const tokens = await GameToken.find({ 'connectionState.autoPushLevel': true });
      console.log(`[ConnMgr] 恢复 ${tokens.length} 个推图连接...`);
      logger.info('ConnMgr', `恢复 ${tokens.length} 个推图连接...`);

      // 清除非推图 token 的 shouldConnect 标记（服务器重启后普通连接不再恢复）
      await GameToken.updateMany(
        { 'connectionState.shouldConnect': true, 'connectionState.autoPushLevel': { $ne: true } },
        { $set: { 'connectionState.shouldConnect': false } },
      ).catch(() => {});

      for (const token of tokens) {
        try {
          await this.connect(token._id.toString(), token.userId.toString(), {
            token: token.token,
            wsUrl: token.wsUrl,
            name: token.name,
          });
          logger.info('ConnMgr', `恢复推图连接: ${token.name}`);
        } catch (err) {
          logger.error('ConnMgr', `恢复连接失败: ${token.name} - ${err.message}`);
        }
      }
    } catch (err) {
      console.error('[ConnMgr] 恢复连接出错:', err.message);
      logger.error('ConnMgr', `恢复连接出错: ${err.message}`);
    }
  }

  /**
   * 建立到游戏服务器的 WebSocket 连接
   * @param {string} tokenId - 前端 token ID（可能不是 MongoDB ObjectId）
   * @param {string} userId - 用户 ID
   * @param {object} [opts] - 可选参数：{ token, wsUrl, name }，前端直传时不依赖 DB
   */
  async connect(tokenId, userId, opts = {}) {
    const id = tokenId.toString();

    if (this.connections.has(id)) {
      const existing = this.connections.get(id);
      if (existing.client?.connected) {
        return { status: 'already_connected' };
      }
      if (existing.client) existing.client.disconnect();
      this.connections.delete(id);
    }

    // 尝试从 DB 查找 token（先按 _id，再按 roleId）
    let tokenDoc = null;
    try {
      const mongoose = require('mongoose');
      if (mongoose.Types.ObjectId.isValid(tokenId)) {
        tokenDoc = await GameToken.findOne({ _id: tokenId, userId });
      }
      if (!tokenDoc) {
        tokenDoc = await GameToken.findOne({ roleId: tokenId, userId });
      }
    } catch (e) {
      // DB 查询失败，继续用直传参数
    }

    // 确定连接参数：优先 DB，fallback 到前端直传
    const gameToken = tokenDoc?.token || opts.token;
    const tokenName = tokenDoc?.name || opts.name || id;
    const customWsUrl = tokenDoc?.wsUrl || opts.wsUrl;

    if (!gameToken) {
      throw new Error('Token not found: 数据库未找到且未提供 token 参数');
    }

    // 持久化：确保 DB 有记录且标记 shouldConnect
    if (tokenDoc) {
      await GameToken.updateOne({ _id: tokenDoc._id }, { $set: { 'connectionState.shouldConnect': true } }).catch(() => {});
    }
    // 不再为前端直传的 token 创建 DB 记录 — token 创建只通过 /api/v1/tokens 导入接口

    const wsUrl = customWsUrl || `wss://xxz-xyzw.hortorgames.com/agent?p=${gameToken}&e=x&lang=chinese`;
    const client = new GameWebSocketClient({ url: wsUrl });
    client.autoReconnect = true; // 由 ConnectionManager 管理的连接默认开启自动重连

    const connInfo = {
      client,
      status: 'connecting',
      tokenName,
      userId: userId.toString(),
      tokenId: id,
      lastActivity: new Date(),
      reconnectCount: 0,
    };

    this.connections.set(id, connInfo);

    client.onConnect = () => {
      connInfo.status = 'connected';
      connInfo.lastActivity = new Date();
      const isReconnect = connInfo.reconnectCount > 0;
      connInfo.reconnectCount = 0;
      console.log(`[ConnMgr] ${tokenName} connected${isReconnect ? ' (重连)' : ''}`);
      logger.connected(id, tokenName);

      // 推送状态更新给前端
      this.pushEvent(userId, 'connectionStatus', {
        tokenId: id,
        status: 'connected',
        connected: true,
        tokenName,
      });

      // 连接成功后自动获取角色信息（同时用于重连后检测被踢）
      try {
        client.sendWithPromise('role_getroleinfo', {}, 15000)
          .catch(e => {
            console.warn(`[ConnMgr] 自动获取角色信息失败 [${tokenName}]:`, e.message);
            logger.warn('ConnMgr', `自动获取角色信息失败 [${tokenName}]: ${e.message}`);
            // 重连后获取角色信息失败 → 很可能被顶号了，主动断开
            if (isReconnect) {
              logger.warn('ConnMgr', `${tokenName} 重连后角色信息获取失败，判定为被踢，停止重连`);
              this._handleKicked(id, connInfo, tokenDoc, userId, tokenName, `重连后验证失败: ${e.message}`);
            }
          });
      } catch (e) { /* ignore */ }
    };

    client.onDisconnect = (event) => {
      const code = event?.code || 'unknown';
      const reason = event?.reason || '';
      const kicked = !!event?.kicked;

      if (kicked) {
        // close code 明确被踢（4xxx 或 reason 匹配）
        this._handleKicked(id, connInfo, tokenDoc, userId, tokenName, reason || `code: ${code}`);
      } else {
        connInfo.status = 'reconnecting';
        connInfo.reconnectCount++;
        logger.disconnected(id, tokenName, code, reason);

        this.pushEvent(userId, 'connectionStatus', {
          tokenId: id,
          status: 'reconnecting',
          connected: false,
          tokenName,
          reconnectCount: connInfo.reconnectCount,
        });
      }
    };

    client.onError = (err) => {
      connInfo.status = 'error';
      console.error(`[ConnMgr] ${tokenName} error:`, err.message || err);
      logger.connectionError(id, tokenName, err.message || String(err));

      this.pushEvent(userId, 'connectionStatus', {
        tokenId: id,
        status: 'error',
        connected: false,
        tokenName,
        error: err.message || String(err),
      });
    };

    // 监听游戏消息，缓存 + 推送
    client.onMessage = (packet) => {
      connInfo.lastActivity = new Date();
      this._handleGameMessage(id, packet);
    };

    client.init();
    return { status: 'connecting' };
  }

  /**
   * 断开连接（用户主动断开）
   */
  async disconnect(tokenId) {
    const id = tokenId.toString();
    const conn = this.connections.get(id);

    // 持久化：取消 shouldConnect（尝试按 _id 和 roleId）
    const mongoose = require('mongoose');
    if (mongoose.Types.ObjectId.isValid(id)) {
      await GameToken.updateOne({ _id: id }, { $set: { 'connectionState.shouldConnect': false } }).catch(() => {});
    } else {
      await GameToken.updateOne({ roleId: id }, { $set: { 'connectionState.shouldConnect': false } }).catch(() => {});
    }

    if (!conn) return false;

    const userId = conn.userId;
    logger.userDisconnect(id, conn.tokenName || id);
    if (conn.client) conn.client.disconnect();
    this.connections.delete(id);
    // 清理游戏数据缓存
    this.gameDataCache.delete(id);

    // 推送断开状态
    if (userId) {
      this.pushEvent(userId, 'connectionStatus', {
        tokenId: id,
        status: 'disconnected',
        connected: false,
      });
    }

    return true;
  }

  /**
   * 获取连接状态
   */
  getStatus(tokenId) {
    const conn = this.connections.get(tokenId.toString());
    if (!conn) return { status: 'disconnected', connected: false };
    return {
      status: conn.status,
      connected: conn.client?.connected || false,
      tokenName: conn.tokenName,
      lastActivity: conn.lastActivity,
      reconnectCount: conn.reconnectCount,
    };
  }

  /**
   * 获取底层 WebSocket 客户端
   */
  getClient(tokenId) {
    const conn = this.connections.get(tokenId.toString());
    return conn?.client || null;
  }

  /**
   * 列出某用户的所有连接（含游戏数据摘要）
   */
  getAllConnections(userId) {
    const result = [];
    for (const [id, conn] of this.connections) {
      if (conn.userId === userId.toString()) {
        const gameData = this.gameDataCache.get(id);
        const roleInfo = gameData?.roleInfo;
        result.push({
          tokenId: id,
          tokenName: conn.tokenName,
          status: conn.status,
          connected: conn.client?.connected || false,
          lastActivity: conn.lastActivity,
          reconnectCount: conn.reconnectCount,
          // 摘要信息
          roleName: roleInfo?.role?.nickName || roleInfo?.role?.name || null,
          roleLevel: roleInfo?.role?.level || null,
          roleAvatar: roleInfo?.role?.headImg || null,
          hasGameData: !!gameData,
        });
      }
    }
    return result;
  }

  /**
   * 发送游戏指令（带等待重连逻辑）
   * 如果当前断线但正在重连，最多等 15 秒
   */
  async sendCommand(tokenId, cmd, params = {}, timeout = 8000) {
    const id = tokenId.toString();
    let conn = this.connections.get(id);

    if (!conn) throw new Error('Not connected');

    // 为战斗相关命令自动注入 battleVersion
    const battleCommands = [
      'fight_startareaarena', 'fight_startpvp', 'fight_starttower',
      'fight_startboss', 'fight_startlegionboss', 'fight_startdungeon', 'fight_level',
    ];
    if (battleCommands.includes(cmd)) {
      const gameData = this.gameDataCache.get(id);
      if (gameData?.battleVersion !== undefined) {
        params = { battleVersion: gameData.battleVersion, ...params };
      }
    }

    // 等待重连：如果断开但 autoReconnect 开着，等连上
    if (!conn.client?.connected && conn.client?.autoReconnect) {
      const waitStart = Date.now();
      const maxWait = 15000;
      while (!conn.client?.connected && (Date.now() - waitStart) < maxWait) {
        await new Promise(r => setTimeout(r, 500));
        conn = this.connections.get(id);
        if (!conn) throw new Error('Connection removed');
      }
      if (!conn.client?.connected) {
        throw new Error('Reconnect timeout, still disconnected');
      }
    }

    if (!conn.client?.connected) throw new Error('Not connected');
    conn.lastActivity = new Date();
    try {
      return await conn.client.sendWithPromise(cmd, params, timeout);
    } catch (err) {
      logger.commandFailed(id, cmd, err.message);
      throw err;
    }
  }

  /**
   * 处理被踢：断开连接，清除 DB 标记，推送状态
   */
  _handleKicked(tokenId, connInfo, tokenDoc, userId, tokenName, reason) {
    connInfo.status = 'kicked';
    if (connInfo.client) {
      connInfo.client.autoReconnect = false;
      connInfo.client.disconnect();
    }

    // 清除 DB 标记
    const mongoose = require('mongoose');
    const clearUpdate = { 'connectionState.shouldConnect': false, 'connectionState.autoPushLevel': false };
    if (tokenDoc) {
      GameToken.updateOne({ _id: tokenDoc._id }, { $set: clearUpdate }).catch(() => {});
    } else if (mongoose.Types.ObjectId.isValid(tokenId)) {
      GameToken.updateOne({ _id: tokenId }, { $set: clearUpdate }).catch(() => {});
    } else {
      GameToken.updateOne({ roleId: tokenId }, { $set: clearUpdate }).catch(() => {});
    }

    logger.warn('ConnMgr', `${tokenName} 被踢下线: ${reason}`);

    this.pushEvent(userId, 'connectionStatus', {
      tokenId,
      status: 'kicked',
      connected: false,
      tokenName,
      kickReason: reason,
    });
  }
}

module.exports = new ConnectionManager();
