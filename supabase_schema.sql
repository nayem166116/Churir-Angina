-- =========================================================
-- Churir Angina -- Supabase Retail POS (Final Plan Schema)
-- Base unit: PCS | Sale default: DOZEN | Box: variable (box_contains_dozen input at purchase time)
-- Run this whole file in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- 1) PROFILES (linked to auth.users)
-- ---------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'owner' check (role in ('owner','manager','cashier')),
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Auto-create profile row on signup (default role = owner since single-shop setup)
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'owner')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------
-- 2) MASTER DATA: categories, products, inventory
-- ---------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  collection text,
  color text,
  size text,
  barcode text unique,
  image_url text,
  cost_per_pcs numeric(12,2) not null default 0,
  default_sale_price_per_dozen numeric(12,2) not null default 0,
  default_sale_price_per_pcs numeric(12,2) not null default 0,
  low_stock_threshold_pcs numeric(12,2) not null default 24,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_products_name on public.products using gin (to_tsvector('simple', name));
create index if not exists idx_products_active on public.products(is_active);

create table if not exists public.inventory (
  product_id uuid primary key references public.products(id) on delete cascade,
  quantity_pcs numeric(14,2) not null default 0,
  updated_at timestamptz not null default now()
);

-- Auto-create inventory row when product created
create or replace function public.handle_new_product()
returns trigger language plpgsql as $$
begin
  insert into public.inventory(product_id, quantity_pcs) values (new.id, 0)
  on conflict (product_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_product_created on public.products;
create trigger on_product_created
after insert on public.products
for each row execute function public.handle_new_product();

-- ---------------------------------------------------------
-- 3) CUSTOMERS / SUPPLIERS
-- ---------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  opening_due numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  opening_due numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 4) SALES / SALE ITEMS
-- ---------------------------------------------------------
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  cashier_id uuid references public.profiles(id),
  customer_id uuid references public.customers(id),
  total_amount numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  due_amount numeric(12,2) not null default 0,
  payment_method text not null default 'cash' check (payment_method in ('cash','mfs','bank','split','due')),
  status text not null default 'active' check (status in ('active','canceled','returned_partial','returned_full')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_sales_created on public.sales(created_at);
create index if not exists idx_sales_customer on public.sales(customer_id);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id),
  qty numeric(12,2) not null,
  unit text not null check (unit in ('pcs','dozen')),
  pcs_per_unit numeric(6,2) not null default 1,
  unit_price_input numeric(12,2) not null,
  unit_price_pcs numeric(12,4) not null,
  subtotal numeric(12,2) not null,
  qty_pcs numeric(12,2) not null
);
create index if not exists idx_sale_items_sale on public.sale_items(sale_id);
create index if not exists idx_sale_items_product on public.sale_items(product_id);

-- ---------------------------------------------------------
-- 5) PURCHASES / PURCHASE ITEMS (variable box handled here)
-- ---------------------------------------------------------
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id),
  bill_no text,
  total_bill numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  due_amount numeric(12,2) not null default 0,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid not null references public.products(id),
  purchase_unit text not null default 'box' check (purchase_unit in ('box','dozen','pcs')),
  qty_unit numeric(12,2) not null,          -- e.g. 4 boxes, or 10 dozen, or 50 pcs
  box_contains_dozen numeric(8,2),          -- only used when purchase_unit = 'box'; e.g. 6
  pcs_per_unit numeric(8,2) not null,       -- computed: box=box_contains_dozen*12, dozen=12, pcs=1
  stock_in_pcs numeric(12,2) not null,      -- computed: qty_unit * pcs_per_unit
  unit_cost numeric(12,2) not null,         -- cost for ONE purchase_unit (per box / per dozen / per pcs)
  cost_per_pcs numeric(12,4) not null       -- computed: unit_cost / pcs_per_unit
);
create index if not exists idx_purchase_items_purchase on public.purchase_items(purchase_id);
create index if not exists idx_purchase_items_product on public.purchase_items(product_id);

create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id),
  purchase_id uuid references public.purchases(id),
  amount numeric(12,2) not null,
  method text default 'cash',
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  sale_id uuid references public.sales(id),
  amount numeric(12,2) not null,
  method text default 'cash',
  note text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 6) RETURNS / CANCEL
-- ---------------------------------------------------------
create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  mode text not null default 'refund' check (mode in ('refund','exchange','due_adjust')),
  total_refund numeric(12,2) not null default 0,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.returns(id) on delete cascade,
  product_id uuid not null references public.products(id),
  qty numeric(12,2) not null,
  unit text not null check (unit in ('pcs','dozen')),
  pcs_per_unit numeric(6,2) not null default 1,
  qty_pcs numeric(12,2) not null,
  refund_amount numeric(12,2) not null default 0
);

create table if not exists public.canceled_sales (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  reason text,
  canceled_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 7) EXPENSES / CASHBOOK / DAILY CLOSING
-- ---------------------------------------------------------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  amount numeric(12,2) not null,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.cashbook (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  description text not null,
  money_in numeric(12,2) not null default 0,
  money_out numeric(12,2) not null default 0,
  method text default 'cash',
  ref_type text,       -- 'sale','purchase','expense','return','partner','loan','manual'
  ref_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_cashbook_date on public.cashbook(entry_date);

create table if not exists public.daily_closing (
  id uuid primary key default gen_random_uuid(),
  closing_date date not null unique,
  opening_cash numeric(12,2) not null default 0,
  expected_cash numeric(12,2) not null default 0,
  actual_cash numeric(12,2) not null default 0,
  difference numeric(12,2) not null default 0,
  note text,
  closed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 8) PARTNERS (35/35/30 style capital share)
-- ---------------------------------------------------------
create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  share_percent numeric(5,2) not null default 0,
  capital_balance numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.partner_tx (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id),
  tx_type text not null check (tx_type in ('capital_in','withdraw','profit_share','loan_in','loan_repay')),
  amount numeric(14,2) not null,
  note text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 9) STOCK ADJUSTMENTS / MOVEMENT / ALERTS
-- ---------------------------------------------------------
create table if not exists public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  change_pcs numeric(12,2) not null,     -- positive = stock in, negative = stock out
  reason text not null check (reason in ('correction','damage','giveaway','internal_use','other')),
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 10) AUDIT LOG / TRASH / BACKUPS
-- ---------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  actor_email text,
  action text not null,
  module text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_created on public.audit_log(created_at);

create table if not exists public.trash (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_json jsonb not null,
  details text,
  deleted_by uuid references public.profiles(id),
  deleted_at timestamptz not null default now()
);

create table if not exists public.backup_snapshots (
  id uuid primary key default gen_random_uuid(),
  version text,
  data_json jsonb not null,
  created_by_email text,
  size numeric default 0,
  created_at timestamptz not null default now()
);

-- =========================================================
-- 11) HELPER: invoice number generator (INV-YYYYMMDD-####)
-- =========================================================
create sequence if not exists public.invoice_seq;

create or replace function public.next_invoice_number()
returns text language plpgsql as $$
declare
  n bigint;
begin
  n := nextval('public.invoice_seq');
  return 'INV-' || to_char(now(),'YYYYMMDD') || '-' || lpad(n::text,4,'0');
end;
$$;

-- =========================================================
-- 12) RPC: complete_sale (ATOMIC)
-- p_items example: [{"product_id":"...","qty":2,"unit":"dozen","unit_price_input":650}]
-- =========================================================
create or replace function public.complete_sale(
  p_customer_id uuid,
  p_payment_method text,
  p_discount numeric,
  p_paid numeric,
  p_items jsonb,
  p_note text default null
)
returns table(invoice_number text, sale_id uuid, total_amount numeric, due_amount numeric)
language plpgsql security definer
as $$
declare
  v_sale_id uuid := gen_random_uuid();
  v_invoice text := public.next_invoice_number();
  v_total numeric := 0;
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_unit text;
  v_pcs_per_unit numeric;
  v_unit_price_input numeric;
  v_unit_price_pcs numeric;
  v_subtotal numeric;
  v_qty_pcs numeric;
  v_current_stock numeric;
  v_due numeric;
  v_actor uuid := auth.uid();
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'No items in sale';
  end if;

  -- Pre-check stock for all items first (lock rows)
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    v_unit := v_item->>'unit';
    v_pcs_per_unit := case when v_unit = 'dozen' then 12 else 1 end;
    v_qty_pcs := v_qty * v_pcs_per_unit;

    select quantity_pcs into v_current_stock from public.inventory where product_id = v_product_id for update;
    if v_current_stock is null then
      raise exception 'Product inventory not found: %', v_product_id;
    end if;
    if v_current_stock < v_qty_pcs then
      raise exception 'Insufficient stock for product %: available % pcs, requested % pcs', v_product_id, v_current_stock, v_qty_pcs;
    end if;
  end loop;

  -- Insert sale header (placeholder total, updated after items)
  insert into public.sales (id, invoice_number, cashier_id, customer_id, total_amount, discount_amount, paid_amount, due_amount, payment_method, status, note)
  values (v_sale_id, v_invoice, v_actor, p_customer_id, 0, coalesce(p_discount,0), coalesce(p_paid,0), 0, coalesce(p_payment_method,'cash'), 'active', p_note);

  -- Insert items + decrement stock
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    v_unit := v_item->>'unit';
    v_unit_price_input := (v_item->>'unit_price_input')::numeric;
    v_pcs_per_unit := case when v_unit = 'dozen' then 12 else 1 end;
    v_qty_pcs := v_qty * v_pcs_per_unit;
    v_unit_price_pcs := v_unit_price_input / v_pcs_per_unit;
    v_subtotal := v_qty * v_unit_price_input;
    v_total := v_total + v_subtotal;

    insert into public.sale_items(sale_id, product_id, qty, unit, pcs_per_unit, unit_price_input, unit_price_pcs, subtotal, qty_pcs)
    values (v_sale_id, v_product_id, v_qty, v_unit, v_pcs_per_unit, v_unit_price_input, v_unit_price_pcs, v_subtotal, v_qty_pcs);

    update public.inventory set quantity_pcs = quantity_pcs - v_qty_pcs, updated_at = now()
    where product_id = v_product_id;
  end loop;

  v_total := v_total - coalesce(p_discount,0);
  v_due := greatest(v_total - coalesce(p_paid,0), 0);

  update public.sales set total_amount = v_total, due_amount = v_due where id = v_sale_id;

  if coalesce(p_paid,0) > 0 then
    insert into public.cashbook(entry_date, description, money_in, money_out, method, ref_type, ref_id)
    values (current_date, 'Sale ' || v_invoice, p_paid, 0, coalesce(p_payment_method,'cash'), 'sale', v_sale_id);
  end if;

  insert into public.audit_log(actor_id, action, module, details)
  values (v_actor, 'complete_sale', 'pos', jsonb_build_object('invoice', v_invoice, 'total', v_total, 'due', v_due));

  return query select v_invoice, v_sale_id, v_total, v_due;
end;
$$;

-- =========================================================
-- 13) RPC: cancel_sale (ATOMIC revert)
-- =========================================================
create or replace function public.cancel_sale(p_invoice_number text, p_reason text default null)
returns void
language plpgsql security definer
as $$
declare
  v_sale record;
  v_item record;
  v_actor uuid := auth.uid();
begin
  select * into v_sale from public.sales where invoice_number = p_invoice_number for update;
  if v_sale is null then
    raise exception 'Sale not found: %', p_invoice_number;
  end if;
  if v_sale.status = 'canceled' then
    raise exception 'Sale already canceled';
  end if;

  for v_item in select * from public.sale_items where sale_id = v_sale.id loop
    update public.inventory set quantity_pcs = quantity_pcs + v_item.qty_pcs, updated_at = now()
    where product_id = v_item.product_id;
  end loop;

  update public.sales set status = 'canceled' where id = v_sale.id;

  if v_sale.paid_amount > 0 then
    insert into public.cashbook(entry_date, description, money_in, money_out, method, ref_type, ref_id)
    values (current_date, 'Cancel ' || p_invoice_number, 0, v_sale.paid_amount, 'cash', 'sale_cancel', v_sale.id);
  end if;

  insert into public.canceled_sales(sale_id, reason, canceled_by) values (v_sale.id, p_reason, v_actor);
  insert into public.audit_log(actor_id, action, module, details)
  values (v_actor, 'cancel_sale', 'pos', jsonb_build_object('invoice', p_invoice_number, 'reason', p_reason));
end;
$$;

-- =========================================================
-- 14) RPC: process_return (partial/full)
-- p_items example: [{"product_id":"...","qty":1,"unit":"pcs","refund_amount":50}]
-- =========================================================
create or replace function public.process_return(
  p_invoice_number text,
  p_items jsonb,
  p_mode text default 'refund'
)
returns uuid
language plpgsql security definer
as $$
declare
  v_sale record;
  v_return_id uuid := gen_random_uuid();
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_unit text;
  v_pcs_per_unit numeric;
  v_qty_pcs numeric;
  v_refund numeric;
  v_total_refund numeric := 0;
  v_actor uuid := auth.uid();
begin
  select * into v_sale from public.sales where invoice_number = p_invoice_number;
  if v_sale is null then
    raise exception 'Sale not found: %', p_invoice_number;
  end if;

  insert into public.returns(id, sale_id, mode, total_refund, created_by)
  values (v_return_id, v_sale.id, p_mode, 0, v_actor);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    v_unit := v_item->>'unit';
    v_refund := coalesce((v_item->>'refund_amount')::numeric, 0);
    v_pcs_per_unit := case when v_unit = 'dozen' then 12 else 1 end;
    v_qty_pcs := v_qty * v_pcs_per_unit;
    v_total_refund := v_total_refund + v_refund;

    insert into public.return_items(return_id, product_id, qty, unit, pcs_per_unit, qty_pcs, refund_amount)
    values (v_return_id, v_product_id, v_qty, v_unit, v_pcs_per_unit, v_qty_pcs, v_refund);

    update public.inventory set quantity_pcs = quantity_pcs + v_qty_pcs, updated_at = now()
    where product_id = v_product_id;
  end loop;

  update public.returns set total_refund = v_total_refund where id = v_return_id;

  if p_mode = 'refund' and v_total_refund > 0 then
    insert into public.cashbook(entry_date, description, money_in, money_out, method, ref_type, ref_id)
    values (current_date, 'Return ' || p_invoice_number, 0, v_total_refund, 'cash', 'return', v_return_id);
  end if;

  update public.sales set status = case when p_mode='refund' then 'returned_partial' else status end where id = v_sale.id;

  insert into public.audit_log(actor_id, action, module, details)
  values (v_actor, 'process_return', 'returns', jsonb_build_object('invoice', p_invoice_number, 'mode', p_mode, 'refund', v_total_refund));

  return v_return_id;
end;
$$;

-- =========================================================
-- 15) RPC: record_purchase (ATOMIC, handles variable box)
-- p_items example:
-- [{"product_id":"...","purchase_unit":"box","qty_unit":4,"box_contains_dozen":6,"unit_cost":3000}]
-- =========================================================
create or replace function public.record_purchase(
  p_supplier_id uuid,
  p_bill_no text,
  p_paid_amount numeric,
  p_items jsonb,
  p_note text default null
)
returns uuid
language plpgsql security definer
as $$
declare
  v_purchase_id uuid := gen_random_uuid();
  v_item jsonb;
  v_product_id uuid;
  v_unit text;
  v_qty_unit numeric;
  v_box_dozen numeric;
  v_pcs_per_unit numeric;
  v_stock_in numeric;
  v_unit_cost numeric;
  v_cost_per_pcs numeric;
  v_total numeric := 0;
  v_actor uuid := auth.uid();
begin
  insert into public.purchases(id, supplier_id, bill_no, total_bill, paid_amount, due_amount, note, created_by)
  values (v_purchase_id, p_supplier_id, p_bill_no, 0, coalesce(p_paid_amount,0), 0, p_note, v_actor);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_unit := v_item->>'purchase_unit';
    v_qty_unit := (v_item->>'qty_unit')::numeric;
    v_box_dozen := nullif(v_item->>'box_contains_dozen','')::numeric;
    v_unit_cost := (v_item->>'unit_cost')::numeric;

    v_pcs_per_unit := case
      when v_unit = 'box' then coalesce(v_box_dozen,1) * 12
      when v_unit = 'dozen' then 12
      else 1
    end;
    v_stock_in := v_qty_unit * v_pcs_per_unit;
    v_cost_per_pcs := v_unit_cost / v_pcs_per_unit;
    v_total := v_total + (v_qty_unit * v_unit_cost);

    insert into public.purchase_items(purchase_id, product_id, purchase_unit, qty_unit, box_contains_dozen, pcs_per_unit, stock_in_pcs, unit_cost, cost_per_pcs)
    values (v_purchase_id, v_product_id, v_unit, v_qty_unit, v_box_dozen, v_pcs_per_unit, v_stock_in, v_unit_cost, v_cost_per_pcs);

    update public.inventory set quantity_pcs = quantity_pcs + v_stock_in, updated_at = now()
    where product_id = v_product_id;

    update public.products set cost_per_pcs = v_cost_per_pcs, updated_at = now()
    where id = v_product_id;
  end loop;

  update public.purchases
  set total_bill = v_total, due_amount = greatest(v_total - coalesce(p_paid_amount,0), 0)
  where id = v_purchase_id;

  if coalesce(p_paid_amount,0) > 0 then
    insert into public.cashbook(entry_date, description, money_in, money_out, method, ref_type, ref_id)
    values (current_date, 'Purchase ' || coalesce(p_bill_no,''), 0, p_paid_amount, 'cash', 'purchase', v_purchase_id);
  end if;

  insert into public.audit_log(actor_id, action, module, details)
  values (v_actor, 'record_purchase', 'purchase', jsonb_build_object('purchase_id', v_purchase_id, 'total', v_total));

  return v_purchase_id;
end;
$$;

-- =========================================================
-- 16) Row Level Security (Owner-only for now; role-ready)
-- =========================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles','categories','products','inventory','customers','suppliers',
    'sales','sale_items','purchases','purchase_items','supplier_payments','customer_payments',
    'returns','return_items','canceled_sales','expenses','cashbook','daily_closing',
    'partners','partner_tx','stock_adjustments','audit_log','trash','backup_snapshots'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists authenticated_all on public.%I', t);
    execute format(
      'create policy authenticated_all on public.%I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- =========================================================
-- 17) Seed categories
-- =========================================================
insert into public.categories(name) values
  ('চুড়ি'),('সেট'),('কানের দুল'),('নেকলেস'),('অন্যান্য')
on conflict (name) do nothing;

select 'Churir Angina Supabase schema ready' as status;
