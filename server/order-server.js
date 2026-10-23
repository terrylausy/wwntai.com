/**
 * wwntAI.com 订单后端（零依赖，Node.js >= 16）
 *
 * 接口：
 *   POST /api/orders          提交订单（公开）
 *   GET  /admin               订单管理页面（公开，查数据需要密钥）
 *   GET  /admin/api/orders    查询订单列表（需密钥，Header X-Admin-Key 或 ?key=）
 *   GET  /healthz             健康检查
 *
 * 启动：node order-server.js
 * 环境变量：PORT（默认 3789）、ADMIN_KEY（管理密钥，务必修改！）
 *
 * 数据存储：data/orders.jsonl（每行一条 JSON，永不覆盖历史）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3789;
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_wwnt-admin-2026';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'orders.jsonl');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '');

// ---- 简单限流：每个 IP 每 10 分钟最多 20 次提交 ----
const rateMap = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const win = 10 * 60 * 1000, max = 20;
  const arr = (rateMap.get(ip) || []).filter(t => now - t < win);
  arr.push(now);
  rateMap.set(ip, arr);
  if (rateMap.size > 5000) rateMap.clear(); // 防内存膨胀
  return arr.length > max;
}

function readOrders() {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const orders = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { orders.push(JSON.parse(s)); } catch (e) { /* 跳过坏行 */ }
  }
  return orders.reverse(); // 最新的在前
}

function saveOrder(order) {
  fs.appendFileSync(DATA_FILE, JSON.stringify(order) + '\n');
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function clean(s, maxLen) {
  return String(s == null ? '' : s).trim().slice(0, maxLen || 500);
}

const ADMIN_HTML_PATH = path.join(__dirname, 'order-admin.html');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  // CORS：同域名部署其实用不到，但留着方便本地调试
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ---- 健康检查 ----
  if (p === '/healthz') return json(res, 200, { ok: true, time: new Date().toISOString() });

  // ---- 提交订单 ----
  if (p === '/api/orders' && req.method === 'POST') {
    if (rateLimited(ip)) return json(res, 429, { ok: false, error: '提交过于频繁，请稍后再试' });

    let body = '';
    let oversized = false;
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 64 * 1024) { oversized = true; req.destroy(); }
    });
    req.on('end', () => {
      if (oversized) return;
      let data;
      try { data = JSON.parse(body || '{}'); }
      catch (e) { return json(res, 400, { ok: false, error: '请求数据格式错误' }); }

      const items = clean(data.items, 1000);
      const buyer_name = clean(data.buyer_name, 100);
      const buyer_phone = clean(data.buyer_phone, 40);
      const buyer_address = clean(data.buyer_address, 500);
      const wx_transaction_id = clean(data.wx_transaction_id, 100);
      const total_amount = clean(data.total_amount, 40);
      const note = clean(data.note, 500);

      if (!items || !buyer_name || !buyer_phone || !buyer_address || !wx_transaction_id) {
        return json(res, 400, { ok: false, error: '必填项缺失：配件/姓名/电话/地址/转账单号' });
      }

      const order = {
        id: 'MD' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase(),
        items, total_amount, buyer_name, buyer_phone, buyer_address,
        wx_transaction_id, note: note || null,
        status: 'pending',
        ip,
        user_agent: clean(req.headers['user-agent'], 200),
        created_at: new Date().toISOString(),
      };
      try {
        saveOrder(order);
      } catch (e) {
        return json(res, 500, { ok: false, error: '服务器保存失败' });
      }
      return json(res, 200, { ok: true, order_id: order.id });
    });
    return;
  }

  // ---- 管理页面 ----
  if (p === '/admin' && req.method === 'GET') {
    fs.readFile(ADMIN_HTML_PATH, (err, buf) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
    return;
  }

  // ---- 查询订单（需密钥）----
  if (p === '/admin/api/orders' && req.method === 'GET') {
    const key = req.headers['x-admin-key'] || url.searchParams.get('key') || '';
    if (key !== ADMIN_KEY) return json(res, 401, { ok: false, error: '密钥错误' });
    let status = url.searchParams.get('status');
    let orders = readOrders();
    if (status) orders = orders.filter(o => o.status === status);
    return json(res, 200, { ok: true, count: orders.length, orders });
  }

  // ---- 更新订单状态（需密钥）----
  if (p === '/admin/api/orders/status' && req.method === 'POST') {
    const key = req.headers['x-admin-key'] || url.searchParams.get('key') || '';
    if (key !== ADMIN_KEY) return json(res, 401, { ok: false, error: '密钥错误' });
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let d;
      try { d = JSON.parse(body || '{}'); } catch (e) { return json(res, 400, { ok: false, error: '格式错误' }); }
      const id = clean(d.id, 60);
      const status = clean(d.status, 20);
      if (!id || !status) return json(res, 400, { ok: false, error: '缺少 id 或 status' });
      const orders = readOrders().reverse(); // 恢复时间正序
      let found = false;
      for (const o of orders) {
        if (o.id === id) { o.status = status; found = true; break; }
      }
      if (!found) return json(res, 404, { ok: false, error: '订单不存在' });
      fs.writeFileSync(DATA_FILE, orders.map(o => JSON.stringify(o)).join('\n') + '\n');
      return json(res, 200, { ok: true });
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[order-server] listening on http://127.0.0.1:${PORT}`);
  if (ADMIN_KEY === 'CHANGE_ME_wwnt-admin-2026') {
    console.warn('[order-server] 警告：请通过环境变量 ADMIN_KEY 设置管理密钥！');
  }
});
