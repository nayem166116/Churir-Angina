-- চুড়ির আঙিনা Supabase Retail POS Pro setup
-- Run this in Supabase Dashboard → SQL Editor → New query → Run
-- This setup stores the POS app data as JSON collections for easy migration from the HTML app.
-- Do NOT expose service_role key in the HTML app. Use only Project URL + anon public key + authenticated users.

-- 1) Main cloud collections table
create table if not exists public.app_collections (
  collection text primary key,
  records jsonb not null default '[]'::jsonb,
  version text,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

-- Auto update updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_collections_updated_at on public.app_collections;
create trigger trg_app_collections_updated_at
before update on public.app_collections
for each row execute function public.set_updated_at();

-- 2) Backup history table
create table if not exists public.app_backups (
  id uuid primary key default gen_random_uuid(),
  version text,
  data jsonb not null,
  created_by_email text,
  size numeric default 0,
  created_at timestamptz not null default now()
);

-- 3) Optional staff profile table for future advanced permission
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  role text default 'staff',
  active boolean default true,
  created_at timestamptz default now()
);

-- 4) Enable Row Level Security
alter table public.app_collections enable row level security;
alter table public.app_backups enable row level security;
alter table public.user_profiles enable row level security;

-- 5) Policies: authenticated users can read/write app data
-- Small shop/team mode. Later you can make stricter owner/manager/staff RLS.
drop policy if exists authenticated_all_app_collections on public.app_collections;
create policy authenticated_all_app_collections
on public.app_collections
for all
to authenticated
using (true)
with check (true);

drop policy if exists authenticated_all_app_backups on public.app_backups;
create policy authenticated_all_app_backups
on public.app_backups
for all
to authenticated
using (true)
with check (true);

drop policy if exists authenticated_all_user_profiles on public.user_profiles;
create policy authenticated_all_user_profiles
on public.user_profiles
for all
to authenticated
using (true)
with check (true);

-- 6) Seed empty collections so Test Connection and Pull work smoothly
insert into public.app_collections (collection, records, version, updated_by_email)
values
('products','[]','2.2.0-supabase','setup'),
('sales','[]','2.2.0-supabase','setup'),
('holds','[]','2.2.0-supabase','setup'),
('purchases','[]','2.2.0-supabase','setup'),
('returns','[]','2.2.0-supabase','setup'),
('purchaseReturns','[]','2.2.0-supabase','setup'),
('expenses','[]','2.2.0-supabase','setup'),
('customers','[]','2.2.0-supabase','setup'),
('suppliers','[]','2.2.0-supabase','setup'),
('partners','[]','2.2.0-supabase','setup'),
('partnerTx','[]','2.2.0-supabase','setup'),
('cashbook','[]','2.2.0-supabase','setup'),
('customerDue','[]','2.2.0-supabase','setup'),
('supplierDue','[]','2.2.0-supabase','setup'),
('customerPayments','[]','2.2.0-supabase','setup'),
('supplierPayments','[]','2.2.0-supabase','setup'),
('closings','[]','2.2.0-supabase','setup'),
('stockAdjustments','[]','2.2.0-supabase','setup'),
('auditLog','[]','2.2.0-supabase','setup'),
('canceledInvoices','[]','2.2.0-supabase','setup'),
('purchaseOrders','[]','2.2.0-supabase','setup'),
('shifts','[]','2.2.0-supabase','setup'),
('backupHistory','[]','2.2.0-supabase','setup'),
('trash','[]','2.2.0-supabase','setup')
on conflict (collection) do nothing;

-- 7) Quick check
select 'Supabase POS setup complete' as status;
