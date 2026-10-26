-- 微信支付云函数所需的订单表字段变更
-- 在 CloudBase「数据库 → SQL 编辑器」执行

-- 微信商户订单号（Native 下单时写入，回调时据此匹配订单）
alter table public.orders add column if not exists wx_out_trade_no text;

-- 说明：wx_transaction_id 字段已存在，微信支付成功后回调会写入微信 transaction_id
