const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

// POST /api/v1/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: '密码至少6位' });
    }

    const exists = await User.findOne({ username });
    if (exists) {
      return res.status(400).json({ success: false, message: '用户名已存在' });
    }

    const user = await User.create({ username, password, email: email || '' });
    const token = signToken(user._id);

    res.status(201).json({
      success: true,
      message: '注册成功',
      data: { token, user: user.toJSON() },
    });
  } catch (err) {
    console.error('注册失败:', err);
    res.status(500).json({ success: false, message: '注册失败' });
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: '账号已被禁用' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    const token = signToken(user._id);

    res.json({
      success: true,
      message: '登录成功',
      data: { token, user: user.toJSON() },
    });
  } catch (err) {
    console.error('登录失败:', err);
    res.status(500).json({ success: false, message: '登录失败' });
  }
});

// GET /api/v1/auth/user
router.get('/user', auth, async (req, res) => {
  res.json({ success: true, data: req.user.toJSON() });
});

// POST /api/v1/auth/refresh
router.post('/refresh', auth, async (req, res) => {
  const token = signToken(req.userId);
  res.json({ success: true, data: { token } });
});

// POST /api/v1/auth/logout
router.post('/logout', auth, (req, res) => {
  // JWT 无状态，客户端删除 token 即可
  res.json({ success: true, message: '已登出' });
});

// PUT /api/v1/user/password
router.put('/user/password', auth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: '请填写新旧密码' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: '新密码至少6位' });
    }

    const user = await User.findById(req.userId);
    const isMatch = await user.comparePassword(oldPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: '旧密码错误' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: '密码修改成功' });
  } catch (err) {
    console.error('修改密码失败:', err);
    res.status(500).json({ success: false, message: '修改密码失败' });
  }
});

// GET /api/v1/user/profile
router.get('/user/profile', auth, async (req, res) => {
  const GameToken = require('../models/GameToken');
  const tokenCount = await GameToken.countDocuments({ userId: req.userId });
  res.json({
    success: true,
    data: { ...req.user.toJSON(), tokenCount },
  });
});

// PUT /api/v1/user/profile
router.put('/user/profile', auth, async (req, res) => {
  try {
    const { email, avatar } = req.body;
    const update = {};
    if (email !== undefined) update.email = email;
    if (avatar !== undefined) update.avatar = avatar;

    const user = await User.findByIdAndUpdate(req.userId, update, { new: true });
    res.json({ success: true, data: user.toJSON() });
  } catch (err) {
    console.error('更新资料失败:', err);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

module.exports = router;
