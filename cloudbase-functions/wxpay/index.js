// ============================================================
// CloudBase 云函数：微信支付 wxpay（普通商户 Native 扫码）
// 部署：CloudBase 控制台新建云函数「wxpay」，粘贴本文件 + package.json，
//       并配置环境变量（密钥一律放环境变量，切勿写入源码/仓库）：
//   MCH_ID            商户号
//   APP_ID            服务号/小程序 appid（需与商户号绑定）
//   API_V3_KEY        APIv3 密钥（32 位，用于回调解密）
//   MCH_PRIVATE_KEY   商户 API 私钥 PEM（apiclient_key.pem 的完整内容）
//   MCH_SERIAL_NO     商户证书序列号
//   WX_PUBLIC_KEY     微信支付公钥 PEM（用于回调验签）
//   NOTIFY_URL        本云函数的 HTTPS 回调地址（部署后填入）
//   PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD  数据库连接（与商城同一 CloudBase PG）
// ============================================================

const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 30000,
});

const MCH_ID = process.env.MCH_ID;
const APP_ID = process.env.APP_ID;
const API_V3_KEY = process.env.API_V3_KEY;
const MCH_PRIVATE_KEY = process.env.MCH_PRIVATE_KEY;
const MCH_SERIAL_NO = process.env.MCH_SERIAL_NO;
const WX_PUBLIC_KEY = process.env.WX_PUBLIC_KEY;
const NOTIFY_URL = process.env.NOTIFY_URL;

const WX_HOST = 'https://api.mch.weixin.qq.com';

function cors() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}
function json(statusCode, obj) {
  return { statusCode, headers: cors(), body: JSON.stringify(obj) };
}

// 商户私钥签名（APIv3 请求签名）
function sign(method, path, timestamp, nonce, body) {
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
  const s = crypto.createSign('RSA-SHA256');
  s.update(message);
  return s.sign(MCH_PRIVATE_KEY, 'base64');
}

// 构造 Authorization 头
function authHeader(method, path, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = sign(method, path, timestamp, nonce, body);
  return 'WECHATPAY2-SHA256-RSA2048 mchid="' + MCH_ID + '",nonce_str="' + nonce + '",signature="' + signature + '",timestamp="' + timestamp + '",serial_no="' + MCH_SERIAL_NO + '"';
}

// Native 统一下单
async function createNativeOrder(outTradeNo, description, amountTotal) {
  const path = '/v3/pay/transactions/native';
  const body = JSON.stringify({
    appid: APP_ID,
    mchid: MCH_ID,
    description: description,
    out_trade_no: outTradeNo,
    notify_url: NOTIFY_URL,
    amount: { total: amountTotal, currency: 'CNY' },
  });
  const res = await fetch(WX_HOST + path, {
    method: 'POST',
    headers: {
      Authorization: authHeader('POST', path, body),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'wwntai-shop/1.0',
    },
    body: body,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  return { status: res.status, data: data };
}

// 回调验签（微信支付公钥）
function verifyNotify(timestamp, nonce, body, signature) {
  const message = `${timestamp}\n${nonce}\n${body}\n`;
  const v = crypto.createVerify('RSA-SHA256');
  v.update(message);
  return v.verify(WX_PUBLIC_KEY, signature, 'base64');
}

// 解密回调 resource（AES-256-GCM，用 APIv3 密钥）
function decryptResource(ciphertext, nonce, associatedData) {
  const key = Buffer.from(API_V3_KEY, 'utf8');
  const data = Buffer.from(ciphertext, 'base64');
  const authTag = data.subarray(data.length - 16);
  const encrypted = data.subarray(0, data.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  decipher.setAuthTag(authTag);
  if (associatedData) decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const out = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(out.toString('utf8'));
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
  }
  return '';
}

exports.main = async (event) => {
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: cors(), body: '' };
  }
  const headers = event.headers || {};

  // 支付回调：微信 POST，带 Wechatpay-Signature 头
  if (pick(headers, ['wechatpay-signature', 'Wechatpay-Signature'])) {
    return await handleNotify(event, headers);
  }

  // 业务请求：创建支付订单
  return await handleCreateOrder(event);
};

async function handleCreateOrder(event) {
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { body = {}; }

  const orderId = String(body.orderId || '');
  const amount = Math.round(Number(body.amount) || 0); // 单位：分
  const description = String(body.description || 'MicroDuck 配件订单').slice(0, 120);
  if (!orderId || amount <= 0) return json(400, { ok: false, error: '缺少订单号或金额' });

  // 生成商户订单号：WX + 时间戳 + 订单号前8位
  const outTradeNo = 'WX' + Date.now() + orderId.slice(0, 8);

  const { status, data } = await createNativeOrder(outTradeNo, description, amount);
  if (status === 200 && data.code_url) {
    await pool.query(
      'update public.orders set wx_out_trade_no=$1 where id=$2',
      [outTradeNo, orderId]
    ).catch(function () {});
    return json(200, { ok: true, codeUrl: data.code_url });
  }
  return json(status, { ok: false, error: (data && data.message) || ('HTTP ' + status) });
}

async function handleNotify(event, headers) {
  const body = event.body || '';
  const timestamp = pick(headers, ['wechatpay-timestamp', 'Wechatpay-Timestamp']);
  const nonce = pick(headers, ['wechatpay-nonce', 'Wechatpay-Nonce']);
  const signature = pick(headers, ['wechatpay-signature', 'Wechatpay-Signature']);

  // 验签
  if (!verifyNotify(timestamp, nonce, body, signature)) {
    return json(401, { code: 'FAIL', message: '验签失败' });
  }

  let notify;
  try { notify = JSON.parse(body); } catch (e) { return json(400, { code: 'FAIL', message: '请求体解析失败' }); }

  // 仅处理支付成功
  if (notify.event_type !== 'TRANSACTION.SUCCESS') {
    return json(200, { code: 'SUCCESS', message: '成功' });
  }

  const resource = notify.resource || {};
  let decrypted;
  try {
    decrypted = decryptResource(resource.ciphertext, resource.nonce, resource.associated_data);
  } catch (e) {
    return json(500, { code: 'FAIL', message: '解密失败' });
  }

  const outTradeNo = decrypted.out_trade_no;
  const wxTransactionId = decrypted.transaction_id;
  const tradeState = decrypted.trade_state;

  if (tradeState === 'SUCCESS' && outTradeNo) {
    await pool.query(
      "update public.orders set status='paid', wx_transaction_id=$1 where wx_out_trade_no=$2 and status <> 'paid'",
      [wxTransactionId || null, outTradeNo]
    ).catch(function () {});
  }

  // 必须返回成功，否则微信会重试
  return json(200, { code: 'SUCCESS', message: '成功' });
}
