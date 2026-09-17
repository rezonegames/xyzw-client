#!/bin/bash

# xyzw_web_helper 部署脚本（前端 + 后端）
# 用法: sh deployment.sh [port]
# 示例: sh deployment.sh         # 默认 8080 端口
# 示例: sh deployment.sh 8080

set -e

HOST=my-server
PORT=${1:-8080}
REMOTE_DIR=/var/www/xyzw_web_helper
REMOTE_SERVER_DIR=/var/www/xyzw_web_helper_server
REMOTE_NGINX_CONF=/etc/nginx/conf.d/xyzw_web_helper.conf

echo "=== [1/6] 本地构建前端 ==="
pnpm install --frozen-lockfile
pnpm run build

if [ ! -d "dist" ]; then
  echo "Error: dist 目录不存在，构建失败"
  exit 1
fi

echo "=== [2/6] 准备远程目录 ==="
ssh $HOST "mkdir -p $REMOTE_DIR $REMOTE_SERVER_DIR"

echo "=== [3/6] 上传前端文件 ==="
rsync -avz --delete dist/ $HOST:$REMOTE_DIR/

echo "=== [4/6] 上传后端文件 ==="
rsync -avz --delete --exclude=node_modules --exclude=.env server/ $HOST:$REMOTE_SERVER_DIR/

echo "=== [5/6] 远程安装依赖并启动后端 ==="
ssh $HOST "bash -l -c '
  cd $REMOTE_SERVER_DIR

  # 如果 .env 不存在，从 .env.example 复制
  if [ ! -f .env ]; then
    cp .env.example .env
    echo \"[注意] 已从 .env.example 创建 .env，请修改 JWT_SECRET\"
  fi

  # 安装依赖
  npm install --production

  # 用 pm2 管理进程
  if command -v pm2 &> /dev/null; then
    pm2 delete xyzw-server 2>/dev/null || true
    pm2 start app.js --name xyzw-server
    pm2 save
  else
    npm install -g pm2
    pm2 start app.js --name xyzw-server
    pm2 save
    pm2 startup 2>/dev/null || true
  fi
'"

echo "=== [6/6] 配置 nginx 并重启 ==="
cat > /tmp/xyzw_web_helper_nginx.conf << NGINX_EOF
server {
    listen       ${PORT};
    listen  [::]:${PORT};
    server_name  xyzw-helper.duckdns.org;

    root   $REMOTE_DIR;
    index  index.html;

    # 后端 API 代理
    location /api/v1/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }

    # 前端路由 history 模式
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # 微信登录接口代理
    location /api/weixin/ {
        proxy_pass https://open.weixin.qq.com/;
        proxy_set_header Host open.weixin.qq.com;
        proxy_set_header User-Agent "Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN";
        proxy_set_header Referer "https://open.weixin.qq.com/";
        proxy_ssl_server_name on;
    }

    # 微信扫码状态轮询代理
    location /api/weixin-long/ {
        proxy_pass https://long.open.weixin.qq.com/;
        proxy_set_header Host long.open.weixin.qq.com;
        proxy_set_header User-Agent "Mozilla/5.0 (Linux; Android 7.0; Mi-4c Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043632 Safari/537.36 MicroMessenger/6.6.1.1220(0x26060135) NetType/WIFI Language/zh_CN";
        proxy_set_header Referer "https://open.weixin.qq.com/";
        proxy_ssl_server_name on;
    }

    # Hortor 登录接口代理
    location /api/hortor/ {
        proxy_pass https://comb-platform.hortorgames.com/;
        proxy_set_header Host comb-platform.hortorgames.com;
        proxy_set_header User-Agent "Mozilla/5.0 (Linux; Android 12; 23117RK66C Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/95.0.4638.74 Mobile Safari/537.36";
        proxy_set_header Origin "https://open.weixin.qq.com";
        proxy_set_header Referer "https://open.weixin.qq.com/";
        proxy_set_header Content-Type "text/plain; charset=utf-8";
        proxy_ssl_server_name on;
    }

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    error_page 500 502 503 504 /50x.html;
    location = /50x.html {
        root /usr/share/nginx/html;
    }
}
NGINX_EOF

scp /tmp/xyzw_web_helper_nginx.conf $HOST:$REMOTE_NGINX_CONF
rm -f /tmp/xyzw_web_helper_nginx.conf

ssh $HOST "chmod -R 755 $REMOTE_DIR && nginx -t && systemctl reload nginx"

echo ""
echo "=== 部署完成 ==="
echo "访问: http://xyzw-helper.duckdns.org:${PORT}"
echo "后端: http://127.0.0.1:3001 (服务器内部)"
