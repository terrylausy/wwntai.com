#!/bin/bash
# wwntAI.com 一键部署脚本（在宝塔终端或 SSH 中执行）
# 用法：把 wwntai-deploy.zip 上传到 /root 后执行 bash deploy.sh

set -e

SITE_DIR=/www/wwwroot/wwntai.com
SERVER_DIR=/www/wwwroot/wwntai-server
ZIP_FILE=${1:-/root/wwntai-deploy.zip}

echo "==> 1. 解压部署包"
rm -rf /tmp/wwntai-deploy
mkdir -p /tmp/wwntai-deploy
unzip -o "$ZIP_FILE" -d /tmp/wwntai-deploy

echo "==> 2. 部署静态网站到 $SITE_DIR"
mkdir -p "$SITE_DIR"
cp -r /tmp/wwntai-deploy/site/* "$SITE_DIR/"

echo "==> 3. 部署订单后端到 $SERVER_DIR"
mkdir -p "$SERVER_DIR"
cp /tmp/wwntai-deploy/server/order-server.js "$SERVER_DIR/"
cp /tmp/wwntai-deploy/server/order-admin.html "$SERVER_DIR/"

echo "==> 4. 安装 systemd 服务（订单后端，开机自启）"
cp /tmp/wwntai-deploy/server/wwntai-orders.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable wwntai-orders
systemctl restart wwntai-orders
sleep 1
systemctl --no-pager status wwntai-orders | head -5

echo "==> 5. 健康检查"
curl -s http://127.0.0.1:3789/healthz && echo ""

echo "==> 6. 设置目录权限"
chown -R www:www "$SITE_DIR" 2>/dev/null || true
chown -R root:root "$SERVER_DIR"

echo ""
echo "✅ 部署完成！"
echo "   静态站点目录：$SITE_DIR （去宝塔-网站-设置里把网站根目录指到这里）"
echo "   订单后端已运行在 127.0.0.1:3789"
echo "   管理密钥（务必修改！见 /etc/systemd/system/wwntai-orders.service 里的 ADMIN_KEY）"
echo "   Nginx 伪静态/反向代理配置见：README-部署指南.md"
