-- ============================================================
-- MicroDuck 配件商城 · 订单表（Supabase）
-- 使用方法：打开 https://supabase.com/dashboard/project/xawygmaszyzcnzwdkvgw/sql/new
-- 把下面整段粘贴进去，点右下角 Run 执行一次即可。
-- ============================================================

-- 1. 建表
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  items text,
  total_amount text,
  buyer_name text,
  buyer_phone text,
  buyer_address text,
  wx_transaction_id text,
  note text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- 2. 开启行级安全（必须开启，下面策略才生效）
alter table public.orders enable row level security;

-- 3. 匿名（不登录）权限策略：游客可下单、可查、可改（录入付款号）
drop policy if exists orders_insert_public on public.orders;
create policy orders_insert_public on public.orders
  for insert to anon
  with check (true);

drop policy if exists orders_select_public on public.orders;
create policy orders_select_public on public.orders
  for select to anon
  using (true);

drop policy if exists orders_update_public on public.orders;
create policy orders_update_public on public.orders
  for update to anon
  using (true)
  with check (true);

-- 4. （可选）已登录用户同样放行，避免未来登录态报错
grant select, insert, update on public.orders to anon, authenticated;
