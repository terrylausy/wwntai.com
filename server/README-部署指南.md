# wwntAI.com 迁移腾讯云服务器部署指南（宝塔面板）

服务器：腾讯云 `111.230.177.252`（宝塔 Linux 面板）
内容：静态官网 + MicroDuck 配件订单系统（同域部署，无跨域问题）

---

## 第 0 步：检查 ICP 备案（重要！）

腾讯云内地服务器对外提供网站服务，域名必须有 ICP 备案。
请到 [腾讯云备案控制台](https://console.cloud.tencent.com/beeb) 确认 `wwntai.com` 是否已备案。
- 已备案 → 继续往下
- 未备案 → 需先备案（约 1~2 周），期间可先用 IP 或临时域名测试

## 第 1 步：上传部署包

1. 把 `wwntai-deploy.zip` 上传到服务器 `/root/` 目录
   （宝塔 → 文件管理 → 进入 /root → 上传）
2. 宝塔 → 终端（或 SSH 登录），执行：

```bash
cd /www/wwwroot
# 下载 deploy.sh（已包含在 zip 内，也可单独上传）
bash /tmp/wwntai-deploy/server/deploy.sh /root/wwntai-deploy.zip
```

> 如果 zip 在别的路径，把最后一个参数换成实际路径。

脚本会自动完成：解压 → 网站文件放到 `/www/wwwroot/wwntai.com` →
订单后端放到 `/www/wwwroot/wwntai-server` → 注册 systemd 服务并启动。

## 第 2 步：宝塔创建网站

1. 宝塔 → 网站 → 添加站点
   - 域名：`wwntai.com` 和 `www.wwntai.com`
   - 根目录：`/www/wwwroot/wwntai.com`
   - PHP 版本：纯静态
2. 站点设置 → SSL → Let's Encrypt 申请免费证书，开启「强制 HTTPS」
3. 站点设置 → 反向代理（或「配置文件」），加入以下内容：

```nginx
    # 订单 API → Node 后端
    location /api/ {
        proxy_pass http://127.0.0.1:3789;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 订单管理页
    location /admin {
        proxy_pass http://127.0.0.1:3789;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
```

4. 保存并重载 Nginx。

## 第 3 步：解析域名

到 DNSPod / 域名注册商处，把 `wwntai.com` 和 `www` 的 A 记录改为 `111.230.177.252`
（原 GitHub Pages 的记录删除或修改）。生效后 `https://www.wwntai.com` 即走腾讯云。

## 第 4 步：验证

```bash
# 服务器上自测
curl http://127.0.0.1:3789/healthz
# 提交测试订单
curl -X POST http://127.0.0.1:3789/api/orders \
  -H "Content-Type: application/json" \
  -d '{"items":"测试散件包 x1","buyer_name":"测试","buyer_phone":"13800000000","buyer_address":"测试地址","wx_transaction_id":"TEST123"}'
# 外网验证
curl https://www.wwntai.com/healthz
```

浏览器打开：
- 配件页：`https://www.wwntai.com/products/microduck-parts.html` → 提交一笔测试订单
- 订单管理：`https://www.wwntai.com/admin` → 输入密钥查看订单

**管理密钥**：`wwnt-admin-2026-Xk7pQ9`（在 `/etc/systemd/system/wwntai-orders.service`
的 `ADMIN_KEY` 里，**上线前务必改成自己的**，改完执行 `systemctl daemon-reload && systemctl restart wwntai-orders`）

## 常用运维命令

```bash
systemctl status wwntai-orders     # 查看运行状态
systemctl restart wwntai-orders    # 重启
cat /www/wwwroot/wwntai-server/data/orders.jsonl   # 原始订单数据（每行一个 JSON）
```

## 订单数据备份

数据在 `/www/wwwroot/wwntai-server/data/orders.jsonl`，建议在宝塔「计划任务」里
加一个每天凌晨打包备份该目录的任务。

## 待办（上线前）

- [ ] 替换配件页两个收款码占位图（微信/支付宝收款码图片，替换
      `assets/images/microduck/qr-wechat.png` 和 `qr-alipay.png`）
- [ ] 修改管理密钥 ADMIN_KEY
- [ ] 确认 ICP 备案状态
- [ ] 核对配件价格表
