-- ============================================================
-- MicroDuck 配件商城 · orders 表权限（腾讯云 CloudBase PG 版）
-- 使用方法：CloudBase 控制台 → SQL 型数据库 → SQL 编辑器
-- 粘贴整段执行一次即可（orders 表需已建好）
-- ============================================================

-- 1. 开启行级安全
alter table public.orders enable row level security;

-- 2. 匿名（游客）权限：可下单、可按手机号查单、可录入付款号
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

-- 3. 表级 GRANT（第一层权限，缺了会被拦）
grant select, insert, update on public.orders to anon;
