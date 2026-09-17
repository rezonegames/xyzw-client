const express = require('express');
const GameToken = require('../models/GameToken');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/v1/tokens — 获取当前用户所有 token
router.get('/', auth, async (req, res) => {
  try {
    const tokens = await GameToken.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json({ success: true, data: tokens });
  } catch (err) {
    console.error('获取token列表失败:', err);
    res.status(500).json({ success: false, message: '获取失败' });
  }
});

// POST /api/v1/tokens — 添加 token
router.post('/', auth, async (req, res) => {
  try {
    const { name, token, wsUrl, server, remark, importMethod, sourceUrl, avatar, level, profession, roleId, binData } = req.body;

    if (!name || !token) {
      return res.status(400).json({ success: false, message: 'name 和 token 不能为空' });
    }

    // 如果同一用户同一 roleId 已存在，更新
    if (roleId) {
      const existing = await GameToken.findOne({ userId: req.userId, roleId });
      if (existing) {
        Object.assign(existing, { name, token, wsUrl, server, remark, importMethod, sourceUrl, avatar, level, profession });
        if (binData) existing.binData = Buffer.from(binData, 'base64');
        await existing.save();
        return res.json({ success: true, data: existing, message: 'Token 已更新' });
      }
    }

    const doc = await GameToken.create({
      userId: req.userId,
      name, token, wsUrl, server, remark,
      importMethod: importMethod || 'manual',
      sourceUrl, avatar, level, profession, roleId,
      binData: binData ? Buffer.from(binData, 'base64') : null,
    });

    res.status(201).json({ success: true, data: doc, message: 'Token 已添加' });
  } catch (err) {
    console.error('添加token失败:', err);
    res.status(500).json({ success: false, message: '添加失败' });
  }
});

// PUT /api/v1/tokens/:id — 更新 token
router.put('/:id', auth, async (req, res) => {
  try {
    const doc = await GameToken.findOne({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ success: false, message: 'Token 不存在' });

    const allowed = ['name', 'token', 'wsUrl', 'server', 'remark', 'sourceUrl', 'avatar', 'level', 'profession', 'isActive', 'dailySettings'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) doc[key] = req.body[key];
    }
    if (req.body.binData) doc.binData = Buffer.from(req.body.binData, 'base64');

    await doc.save();
    res.json({ success: true, data: doc });
  } catch (err) {
    console.error('更新token失败:', err);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

// DELETE /api/v1/tokens/:id — 删除 token
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await GameToken.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!result) return res.status(404).json({ success: false, message: 'Token 不存在' });
    res.json({ success: true, message: '已删除' });
  } catch (err) {
    console.error('删除token失败:', err);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

// POST /api/v1/tokens/import — 批量导入
router.post('/import', auth, async (req, res) => {
  try {
    const { tokens } = req.body;
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({ success: false, message: '无效的导入数据' });
    }

    let imported = 0;
    let updated = 0;

    for (const t of tokens) {
      if (!t.name || !t.token) continue;

      const query = t.roleId
        ? { userId: req.userId, roleId: t.roleId }
        : { userId: req.userId, name: t.name, server: t.server || '' };

      const existing = await GameToken.findOne(query);
      if (existing) {
        Object.assign(existing, {
          name: t.name, token: t.token, wsUrl: t.wsUrl || null,
          server: t.server || '', remark: t.remark || '',
          importMethod: t.importMethod || 'manual',
          avatar: t.avatar || '', level: t.level || 0,
          profession: t.profession || '',
        });
        await existing.save();
        updated++;
      } else {
        await GameToken.create({
          userId: req.userId,
          name: t.name, token: t.token, wsUrl: t.wsUrl || null,
          server: t.server || '', remark: t.remark || '',
          importMethod: t.importMethod || 'manual',
          roleId: t.roleId || '', avatar: t.avatar || '',
          level: t.level || 0, profession: t.profession || '',
        });
        imported++;
      }
    }

    res.json({ success: true, message: `导入 ${imported} 个，更新 ${updated} 个`, data: { imported, updated } });
  } catch (err) {
    console.error('导入失败:', err);
    res.status(500).json({ success: false, message: '导入失败' });
  }
});

// GET /api/v1/tokens/export — 导出所有 token
router.get('/export', auth, async (req, res) => {
  try {
    const tokens = await GameToken.find({ userId: req.userId }).lean();
    // 移除内部字段
    const exportData = tokens.map(t => {
      const { _id, userId, __v, binData, ...rest } = t;
      return rest;
    });
    res.json({ success: true, data: exportData });
  } catch (err) {
    console.error('导出失败:', err);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});

// PUT /api/v1/tokens/:id/daily-settings — 更新日常任务设置
router.put('/:id/daily-settings', auth, async (req, res) => {
  try {
    const doc = await GameToken.findOne({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ success: false, message: 'Token 不存在' });

    doc.dailySettings = req.body;
    await doc.save();
    res.json({ success: true, data: doc.dailySettings });
  } catch (err) {
    console.error('更新日常设置失败:', err);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

module.exports = router;
