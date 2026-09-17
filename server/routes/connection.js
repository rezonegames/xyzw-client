/**
 * WebSocket 连接管理 API 路由
 * 挂载路径: /api/v1/connections
 */

const express = require('express');
const auth = require('../middleware/auth');
const connectionManager = require('../services/ConnectionManager');
const logger = require('../utils/logger');

const router = express.Router();

// ─────────── SSE 端点 ───────────

// GET /api/v1/connections/events — SSE 实时推送（连接状态、游戏消息、任务进度）
// EventSource 不支持自定义 header，所以用 query 参数传递 token
router.get('/events', async (req, res) => {
  // 手动验证 token（从 query 参数）
  const jwt = require('jsonwebtoken');
  const User = require('../models/User');
  const tokenStr = req.query.token;
  if (!tokenStr) {
    return res.status(401).json({ success: false, message: 'token required' });
  }
  try {
    const decoded = jwt.verify(tokenStr, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: '用户不存在或已禁用' });
    }
    req.userId = user._id;
  } catch (err) {
    return res.status(401).json({ success: false, message: '认证失败' });
  }
  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx 不缓冲
  });

  // 发送初始连接确认
  res.write(`event: connected\ndata: ${JSON.stringify({ message: 'SSE connected' })}\n\n`);

  // 注册 SSE 客户端
  connectionManager.addSSEClient(req.userId, res);

  // 立即推送当前所有连接状态
  const conns = connectionManager.getAllConnections(req.userId);
  res.write(`event: snapshot\ndata: ${JSON.stringify({ connections: conns })}\n\n`);

  // 心跳保活（每 30 秒）
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch (e) {
      clearInterval(heartbeat);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

// ─────────── 连接管理 ───────────

// POST /api/v1/connections/:tokenId/connect — 建立到游戏服务器的连接
router.post('/:tokenId/connect', auth, async (req, res) => {
  try {
    const { token, wsUrl, name } = req.body || {};
    const result = await connectionManager.connect(req.params.tokenId, req.userId, { token, wsUrl, name });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/v1/connections/:tokenId/disconnect — 断开连接
router.post('/:tokenId/disconnect', auth, async (req, res) => {
  const ok = await connectionManager.disconnect(req.params.tokenId);
  res.json({ success: true, data: { disconnected: ok } });
});

// GET /api/v1/connections/:tokenId/status — 获取连接状态
router.get('/:tokenId/status', auth, (req, res) => {
  const status = connectionManager.getStatus(req.params.tokenId);
  res.json({ success: true, data: status });
});

// GET /api/v1/connections — 列出当前用户所有连接（含角色摘要）
router.get('/', auth, (req, res) => {
  const conns = connectionManager.getAllConnections(req.userId);
  res.json({ success: true, data: conns });
});

// ─────────── 游戏数据 ───────────

// GET /api/v1/connections/:tokenId/gamedata — 获取缓存的游戏数据（角色信息等）
router.get('/:tokenId/gamedata', auth, (req, res) => {
  const data = connectionManager.getGameData(req.params.tokenId);
  if (!data) {
    return res.json({ success: true, data: null, message: '暂无游戏数据，请先连接' });
  }
  res.json({ success: true, data });
});

// GET /api/v1/connections/:tokenId/roleinfo — 获取角色信息（优先缓存，可强制刷新）
router.get('/:tokenId/roleinfo', auth, async (req, res) => {
  try {
    const tokenId = req.params.tokenId;
    const forceRefresh = req.query.refresh === 'true';

    // 先检查缓存
    if (!forceRefresh) {
      const cached = connectionManager.getGameData(tokenId);
      if (cached?.roleInfo) {
        return res.json({ success: true, data: cached.roleInfo, cached: true });
      }
    }

    // 缓存没有或强制刷新：发送命令获取
    const result = await connectionManager.sendCommand(tokenId, 'role_getroleinfo', {}, 15000);
    res.json({ success: true, data: result, cached: false });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────── 游戏命令 ───────────

// POST /api/v1/connections/:tokenId/command — 发送游戏命令
router.post('/:tokenId/command', auth, async (req, res) => {
  try {
    const { cmd, params, timeout } = req.body;
    if (!cmd) return res.status(400).json({ success: false, message: 'cmd is required' });
    const result = await connectionManager.sendCommand(
      req.params.tokenId,
      cmd,
      params || {},
      timeout || 8000,
    );
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/v1/connections/:tokenId/batch-command — 批量发送游戏命令（按顺序执行）
router.post('/:tokenId/batch-command', auth, async (req, res) => {
  try {
    const { commands } = req.body;
    if (!Array.isArray(commands) || commands.length === 0) {
      return res.status(400).json({ success: false, message: 'commands array is required' });
    }

    const results = [];
    for (const item of commands) {
      try {
        const result = await connectionManager.sendCommand(
          req.params.tokenId,
          item.cmd,
          item.params || {},
          item.timeout || 8000,
        );
        results.push({ cmd: item.cmd, success: true, data: result });
      } catch (err) {
        results.push({ cmd: item.cmd, success: false, error: err.message });
      }

      // 命令间延迟
      if (item.delay) {
        await new Promise(r => setTimeout(r, item.delay));
      }
    }

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────── 日志查看 ───────────

// GET /api/v1/connections/logs — 查看后端日志文件列表
router.get('/logs/list', auth, (req, res) => {
  const fs = require('fs');
  const logDir = logger.getLogDir();
  try {
    const files = fs.readdirSync(logDir)
      .filter(f => f.endsWith('.log'))
      .sort()
      .reverse();
    res.json({ success: true, data: files, logDir });
  } catch (err) {
    res.json({ success: true, data: [], logDir });
  }
});

// GET /api/v1/connections/logs/:filename — 查看指定日志文件（最后 N 行）
router.get('/logs/:filename', auth, (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const logDir = logger.getLogDir();
  const filename = req.params.filename;

  // 安全检查：只允许 .log 文件，不允许路径穿越
  if (!filename.endsWith('.log') || filename.includes('/') || filename.includes('..')) {
    return res.status(400).json({ success: false, message: 'Invalid filename' });
  }

  const filePath = path.join(logDir, filename);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const tail = parseInt(req.query.tail) || 200;
    const filter = req.query.filter; // 可选过滤词
    let filtered = lines;
    if (filter) {
      filtered = lines.filter(l => l.includes(filter));
    }
    res.json({
      success: true,
      data: filtered.slice(-tail),
      total: filtered.length,
      filename,
    });
  } catch (err) {
    res.status(404).json({ success: false, message: 'Log file not found' });
  }
});

module.exports = router;
