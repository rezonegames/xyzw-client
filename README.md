# XYZW 助手

游戏辅助管理工具。支持多账号主线推关（后端执行，关闭浏览器不停止）、批量日常任务、Token 管理。

**本工具完全免费，不收取任何费用，仅供学习交流使用，不用于商业用途。**

## 架构

```
浏览器 (Vue 3 + Naive UI)
  ↓ REST API + SSE
Nginx (:8080) → Node.js 后端 (:3001) → MongoDB
                      ↓ WebSocket
               游戏服务器 (由后端管理)
```

- 前端：Vue 3 / Vite / Naive UI / Pinia
- 后端：Node.js / Express / Mongoose / ws
- 数据库：MongoDB
- 部署：pm2 + Nginx

## 功能

| 模块 | 说明 |
|------|------|
| 主线推关 | 后端执行推关循环，关闭浏览器不停止，支持自动继续、火把、逢百关升级挂机 |
| 批量日常 | 多账号批量执行日常任务，支持定时任务和分组管理 |
| Token 管理 | 右上角弹窗管理，支持手动/BIN/URL/微信扫码导入 |

## 部署

### 前提条件

- 服务器安装 Node.js 18+、MongoDB、Nginx、pm2
- 本地安装 pnpm（用于构建前端）

### 一键部署

```bash
# 编辑 deployment.sh 中的 HOST 和 PORT
sh deployment.sh
```

脚本会自动：
1. 本地 `pnpm build` 构建前端
2. 上传前端到 `/var/www/xyzw_web_helper`
3. 上传后端到 `/var/www/xyzw_web_helper_server`
4. 远程 `npm install` + pm2 启动后端
5. 配置 Nginx 反向代理并 reload

### 手动部署

```bash
# 1. 构建前端
pnpm install
pnpm build

# 2. 上传 dist/ 到服务器 web 目录

# 3. 上传 server/ 到服务器
cd server
npm install --production

# 4. 配置 .env
cp .env.example .env
# 编辑 MONGO_URI、JWT_SECRET

# 5. 启动后端
pm2 start app.js --name xyzw-server
pm2 save

# 6. 配置 Nginx 代理 /api/v1/ → localhost:3001
```

### 环境变量（server/.env）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MONGO_URI` | MongoDB 连接地址 | `mongodb://127.0.0.1:27017/xyzw_web_helper` |
| `JWT_SECRET` | JWT 签名密钥 | 必须修改 |
| `JWT_EXPIRES_IN` | Token 有效期 | `7d` |
| `PORT` | 后端端口 | `3001` |

## 项目结构

```
├── deployment.sh        # 一键部署脚本
├── index.html           # Vite 入口
├── vite.config.js       # Vite 配置
├── package.json         # 前端依赖
├── src/                 # 前端源码
│   ├── api/             # 后端 API 调用
│   ├── layout/          # 布局（导航栏）
│   ├── router/          # 路由（推关、批量日常）
│   ├── stores/          # Pinia 状态管理
│   ├── views/           # 页面组件
│   └── utils/           # 工具函数
└── server/              # 后端源码
    ├── app.js           # Express 入口
    ├── middleware/       # JWT 认证
    ├── models/          # Mongoose 模型
    ├── routes/          # API 路由
    ├── services/        # 业务逻辑
    │   ├── ConnectionManager.js  # WebSocket 连接管理
    │   ├── LevelPusher.js        # 主线推关引擎
    │   └── TaskRunner.js         # 日常任务执行器
    ├── utils/
    │   ├── GameWebSocket.js      # 游戏 WebSocket 客户端
    │   ├── bonProtocol.js        # BON 协议编解码
    │   └── logger.js             # 文件日志模块
    └── logs/            # 日志文件（按天滚动）

```

## 查看后端日志

```bash
# SSH 到服务器
ssh my-server

# 实时日志
pm2 logs xyzw-server

# 文件日志（按天）
cat /var/www/xyzw_web_helper_server/logs/$(date +%Y-%m-%d).log

# 只看断开记录
grep DISC /var/www/xyzw_web_helper_server/logs/$(date +%Y-%m-%d).log

# 只看错误
grep ERROR /var/www/xyzw_web_helper_server/logs/$(date +%Y-%m-%d).log

# 通过 API 查看（浏览器）
# GET /api/v1/connections/logs/list
# GET /api/v1/connections/logs/2025-01-01.log?tail=100&filter=ERROR
```

## License

CC-BY-NC-SA-4.0
