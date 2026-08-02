-- =====================================================================
-- SCHEMA FIX -- run this FIRST in Supabase > SQL Editor
-- Fixes: "Could not find the 'box_contains_dozen' column of 'products'"
-- Safe to run many times. No data is deleted.
-- =====================================================================

-- PRODUCTS: make sure every column the app writes actually exists
alter table public.products add column if not exists sku                     text;
alter table public.products add column if not exists barcode                 text;
alter table public.products add column if not exists category                text;
alter table public.products add column if not exists box_contains_dozen      numeric not null default 0;
alter table public.products add column if not exists cost_price_pcs          numeric not null default 0;
alter table public.products add column if not exists sale_price_pcs          numeric not null default 0;
alter table public.products add column if not exists stock_pcs               numeric not null default 0;
alter table public.products add column if not exists low_stock_threshold_pcs numeric not null default 12;
alter table public.products add column if not exists active                  boolean not null default true;
alter table public.products add column if not exists created_at              timestamptz not null default now();

create index if not exists products_barcode_idx on public.products (barcode);
create index if not exists products_name_idx    on public.products (name);

-- If an older column named price_pcs exists, copy its values across once
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='products' and column_name='price_pcs') then
    execute 'update public.products set sale_price_pcs = coalesce(nullif(sale_price_pcs,0), price_pcs) where price_pcs is not null';
  end if;
end $$;

-- CUSTOMERS / SUPPLIERS: columns the app writes
alter table public.customers add column if not exists address text;
alter table public.suppliers add column if not exists address text;
alter table public.suppliers add column if not exists phone   text;

-- EXPENSES: columns the app writes
alter table public.expenses add column if not exists category text;
alter table public.expenses add column if not exists note     text;

-- Reload PostgREST schema cache so the app sees new columns instantly
notify pgrst, 'reload schema';

-- =====================================================================
-- Done. If you see "Success", open the app and add a product again.
-- =====================================================================
