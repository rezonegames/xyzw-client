require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const gameTokenRoutes = require('./routes/gameToken');
const connectionRoutes = require('./routes/connection');
const taskRoutes = require('./routes/task');
const levelPushRoutes = require('./routes/levelPush');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API 路由
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/user', authRoutes);  // user/profile, user/password 也在 auth 路由里
app.use('/api/v1/tokens', gameTokenRoutes);
app.use('/api/v1/connections', connectionRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/level-push', levelPushRoutes);

// 静态文件（生产环境由 nginx 托管，这里兜底）
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

// 连接 MongoDB 并启动
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/xyzw_web_helper')
  .then(async () => {
    console.log('MongoDB 已连接');

    // 恢复之前的 WebSocket 连接
    const connectionManager = require('./services/ConnectionManager');
    await connectionManager.restoreConnections();

    // 恢复推图任务（在连接恢复后）
    const levelPusher = require('./services/LevelPusher');
    await levelPusher.restorePushingLevels();

    // 启动定时任务调度器
    const taskScheduler = require('./services/TaskScheduler');
    taskScheduler.start();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('MongoDB 连接失败:', err.message);
    process.exit(1);
  });
