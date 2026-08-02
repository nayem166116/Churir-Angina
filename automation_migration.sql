-- =====================================================================
-- CHURIR ANGINA POS -- AUTOMATION MIGRATION
-- Supabase SQL Editor e puro file ta paste kore RUN korun.
-- 100% NIRAPOD: purono data mucbe na. Duibar run korleo somossa nei.
-- =====================================================================

-- 1) CUSTOMERS e membership + loyalty column
alter table public.customers add column if not exists is_member        boolean not null default false;
alter table public.customers add column if not exists member_since     timestamptz;
alter table public.customers add column if not exists member_code      text;
alter table public.customers add column if not exists loyalty_points   numeric not null default 0;
alter table public.customers add column if not exists total_spent      numeric not null default 0;
alter table public.customers add column if not exists visit_count      integer not null default 0;
alter table public.customers add column if not exists last_visit_at    timestamptz;
alter table public.customers add column if not exists tier             text not null default 'silver';
alter table public.customers add column if not exists birthday         date;
alter table public.customers add column if not exists whatsapp_opt_in  boolean not null default true;
alter table public.customers add column if not exists auto_created     boolean not null default false;

create unique index if not exists customers_phone_unique_idx
  on public.customers (phone)
  where phone is not null and phone <> '';

-- 2) PRODUCTS e barcode column
alter table public.products add column if not exists barcode text;
create index if not exists products_barcode_idx on public.products (barcode);

-- 3) SHOP SETTINGS
create table if not exists public.shop_settings (
  id                      integer primary key default 1,
  shop_name               text default 'Churir Angina',
  shop_phone              text,
  shop_address            text,
  owner_whatsapp          text,
  receipt_footer          text default 'Dhonnobad! Abar ashben.',
  loyalty_enabled         boolean not null default true,
  points_per_100_taka     numeric not null default 1,
  point_value_taka        numeric not null default 1,
  min_points_to_redeem    numeric not null default 50,
  auto_membership_enabled boolean not null default true,
  tier_gold_at            numeric not null default 20000,
  tier_platinum_at        numeric not null default 50000,
  whatsapp_enabled        boolean not null default true,
  whatsapp_country_code   text not null default '880',
  updated_at              timestamptz not null default now(),
  constraint shop_settings_single_row check (id = 1)
);

insert into public.shop_settings (id) values (1) on conflict (id) do nothing;

alter table public.shop_settings enable row level security;

drop policy if exists shop_settings_read on public.shop_settings;
create policy shop_settings_read on public.shop_settings
  for select to authenticated using (true);

drop policy if exists shop_settings_write on public.shop_settings;
create policy shop_settings_write on public.shop_settings
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','manager')));

-- 4) LOYALTY TX LOG
create table if not exists public.loyalty_tx (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  sale_id     uuid,
  points      numeric not null default 0,
  type        text not null default 'earn',
  note        text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists loyalty_tx_customer_idx on public.loyalty_tx (customer_id, created_at desc);
alter table public.loyalty_tx enable row level security;
drop policy if exists loyalty_tx_read on public.loyalty_tx;
create policy loyalty_tx_read on public.loyalty_tx for select to authenticated using (true);
drop policy if exists loyalty_tx_insert on public.loyalty_tx;
create policy loyalty_tx_insert on public.loyalty_tx for insert to authenticated with check (true);

-- 5) MESSAGE LOG
create table if not exists public.message_log (
  id          uuid primary key default gen_random_uuid(),
  channel     text not null default 'whatsapp',
  purpose     text not null default 'receipt',
  to_phone    text,
  customer_id uuid,
  sale_id     uuid,
  body        text,
  status      text not null default 'opened',
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists message_log_created_idx on public.message_log (created_at desc);
alter table public.message_log enable row level security;
drop policy if exists message_log_read on public.message_log;
create policy message_log_read on public.message_log for select to authenticated using (true);
drop policy if exists message_log_insert on public.message_log;
create policy message_log_insert on public.message_log for insert to authenticated with check (true);

-- 6) RPC: upsert_member
create or replace function public.upsert_member(p_phone text, p_name text default null)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_digits text;
  v_cust public.customers;
  v_code text;
begin
  if p_phone is null or btrim(p_phone) = '' then
    raise exception 'Phone number lagbe';
  end if;

  v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');

  if length(v_digits) = 13 and left(v_digits, 3) = '880' then
    v_phone := '0' || substring(v_digits from 4);
  elsif length(v_digits) = 10 and left(v_digits, 1) = '1' then
    v_phone := '0' || v_digits;
  else
    v_phone := v_digits;
  end if;

  if length(v_phone) < 10 then
    raise exception 'Phone number thik nei';
  end if;

  select * into v_cust from public.customers where phone = v_phone limit 1;

  if found then
    update public.customers
       set is_member    = true,
           member_since = coalesce(member_since, now()),
           member_code  = coalesce(member_code, 'M' || lpad((floor(random()*90000)+10000)::text, 5, '0')),
           name         = case when (name is null or btrim(name) = '' or name = phone)
                                 and p_name is not null and btrim(p_name) <> ''
                               then p_name else name end
     where id = v_cust.id
     returning * into v_cust;
    return v_cust;
  end if;

  v_code := 'M' || lpad((floor(random()*90000)+10000)::text, 5, '0');

  insert into public.customers (name, phone, is_member, member_since, member_code, auto_created)
  values (coalesce(nullif(btrim(p_name), ''), v_phone), v_phone, true, now(), v_code, true)
  returning * into v_cust;

  return v_cust;
end;
$$;
grant execute on function public.upsert_member(text, text) to authenticated;

-- 7) RPC: apply_loyalty
create or replace function public.apply_loyalty(p_customer_id uuid, p_sale_id uuid, p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set    public.shop_settings;
  v_points numeric := 0;
  v_total  numeric := 0;
  v_tier   text := 'silver';
begin
  if p_customer_id is null then return 0; end if;

  select * into v_set from public.shop_settings where id = 1;
  if not found or v_set.loyalty_enabled is false then return 0; end if;

  v_points := floor(coalesce(p_amount,0) / 100.0) * coalesce(v_set.points_per_100_taka, 1);

  update public.customers
     set loyalty_points = coalesce(loyalty_points,0) + v_points,
         total_spent    = coalesce(total_spent,0) + coalesce(p_amount,0),
         visit_count    = coalesce(visit_count,0) + 1,
         last_visit_at  = now()
   where id = p_customer_id
   returning total_spent into v_total;

  if v_total >= coalesce(v_set.tier_platinum_at, 50000) then
    v_tier := 'platinum';
  elsif v_total >= coalesce(v_set.tier_gold_at, 20000) then
    v_tier := 'gold';
  end if;

  update public.customers set tier = v_tier where id = p_customer_id;

  if v_points > 0 then
    insert into public.loyalty_tx (customer_id, sale_id, points, type, note, created_by)
    values (p_customer_id, p_sale_id, v_points, 'earn', 'Sale theke jomma', auth.uid());
  end if;

  return v_points;
end;
$$;
grant execute on function public.apply_loyalty(uuid, uuid, numeric) to authenticated;

-- 8) RPC: redeem_points
create or replace function public.redeem_points(p_customer_id uuid, p_points numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set  public.shop_settings;
  v_have numeric := 0;
  v_taka numeric := 0;
begin
  if p_customer_id is null or coalesce(p_points,0) <= 0 then return 0; end if;

  select * into v_set from public.shop_settings where id = 1;
  if not found or v_set.loyalty_enabled is false then return 0; end if;

  select coalesce(loyalty_points,0) into v_have from public.customers where id = p_customer_id;

  if v_have < p_points then
    raise exception 'Josthesto point nei (ache %, chaowa hoyeche %)', v_have, p_points;
  end if;

  if p_points < coalesce(v_set.min_points_to_redeem, 50) then
    raise exception 'Kompokkhe % point lagbe', v_set.min_points_to_redeem;
  end if;

  v_taka := p_points * coalesce(v_set.point_value_taka, 1);

  update public.customers set loyalty_points = coalesce(loyalty_points,0) - p_points
   where id = p_customer_id;

  insert into public.loyalty_tx (customer_id, points, type, note, created_by)
  values (p_customer_id, -p_points, 'redeem', 'Discount hisebe byabohar', auth.uid());

  return v_taka;
end;
$$;
grant execute on function public.redeem_points(uuid, numeric) to authenticated;

-- 9) BACKFILL: jader phone ache tara shobai member
update public.customers
   set is_member    = true,
       member_since = coalesce(member_since, coalesce(created_at, now())),
       member_code  = coalesce(member_code, 'M' || lpad((floor(random()*90000)+10000)::text, 5, '0'))
 where phone is not null and btrim(phone) <> '' and is_member = false;

-- =====================================================================
-- SOB SHESH. "Success" dekhale kaj hoye geche.
-- =====================================================================
