/**
 * 主线推关 API 路由
 * 挂载路径: /api/v1/level-push
 */

const express = require('express');
const auth = require('../middleware/auth');
const levelPusher = require('../services/LevelPusher');
const connectionManager = require('../services/ConnectionManager');

const router = express.Router();

// POST /api/v1/level-push/:tokenId/start — 开始推关
router.post('/:tokenId/start', auth, async (req, res) => {
  try {
    const { maxRetries, autoContinue } = req.body || {};

    // 确保连接存在
    const connStatus = connectionManager.getStatus(req.params.tokenId);
    if (!connStatus.connected) {
      // 尝试建立连接
      const { token, wsUrl, name } = req.body || {};
      if (token) {
        await connectionManager.connect(req.params.tokenId, req.userId, { token, wsUrl, name });
        // 等待连接建立
        const waitStart = Date.now();
        while (Date.now() - waitStart < 5000) {
          if (connectionManager.getStatus(req.params.tokenId).connected) break;
          await new Promise(r => setTimeout(r, 500));
        }
      }
      if (!connectionManager.getStatus(req.params.tokenId).connected) {
        return res.status(400).json({ success: false, message: '游戏服务器未连接，请先连接' });
      }
    }

    const result = await levelPusher.start(req.params.tokenId, { maxRetries, autoContinue });
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/v1/level-push/:tokenId/stop — 停止推关
router.post('/:tokenId/stop', auth, (req, res) => {
  const result = levelPusher.stop(req.params.tokenId);
  res.json({ success: true, data: result });
});

// GET /api/v1/level-push/:tokenId/status — 获取某个 token 的推关状态
router.get('/:tokenId/status', auth, (req, res) => {
  const status = levelPusher.getStatus(req.params.tokenId);
  res.json({ success: true, data: status });
});

// GET /api/v1/level-push/status — 获取所有推关状态
router.get('/status', auth, (req, res) => {
  const all = levelPusher.getAllStatus();
  res.json({ success: true, data: all });
});

// POST /api/v1/level-push/:tokenId/torch — 使用火把
router.post('/:tokenId/torch', auth, async (req, res) => {
  try {
    const { itemId, quantity } = req.body;
    if (!itemId) return res.status(400).json({ success: false, message: 'itemId is required' });

    // 确保连接
    const connStatus = connectionManager.getStatus(req.params.tokenId);
    if (!connStatus.connected) {
      const { token, wsUrl, name } = req.body || {};
      if (token) {
        await connectionManager.connect(req.params.tokenId, req.userId, { token, wsUrl, name });
        const waitStart = Date.now();
        while (Date.now() - waitStart < 5000) {
          if (connectionManager.getStatus(req.params.tokenId).connected) break;
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }

    const result = await levelPusher.useTorch(req.params.tokenId, itemId, quantity || 1);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
