-- ============================================================================
-- Aroless Affiliate / Partner Program — schema migration
-- Run this once in the Supabase SQL editor (project → SQL → New query).
-- It is idempotent: safe to re-run.
--
-- Contents:
--   1. affiliates          — partner records (rate, duration, status, code)
--   2. affiliate_referrals — immutable first-touch attribution per customer
--   3. affiliate_clicks    — raw link click/visitor tracking (deduplicated)
--   4. commissions         — per-payment commission rows (idempotent, append-only)
--   5. Admin role grant for mk65449131@gmail.com
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. affiliates
-- ---------------------------------------------------------------------------
create table if not exists public.affiliates (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.profiles (id) on delete cascade,
  display_name              text not null default '',
  referral_code             text not null,
  commission_rate_pct       numeric(5, 2) not null default 30,
  commission_duration_months integer not null default 12,
  status                    text not null default 'active'
                            check (status in ('active', 'inactive')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint affiliates_user_id_key unique (user_id),
  constraint affiliates_referral_code_key unique (referral_code),
  constraint affiliates_rate_range check (commission_rate_pct >= 0 and commission_rate_pct <= 100),
  constraint affiliates_duration_range check (commission_duration_months between 1 and 24)
);

comment on table public.affiliates is
  'Affiliate/partner records. commission_rate_pct and commission_duration_months are configured by admins only — never trusted from the client.';

create index if not exists affiliates_status_idx on public.affiliates (status);
create index if not exists affiliates_user_id_idx on public.affiliates (user_id);

-- ---------------------------------------------------------------------------
-- 2. affiliate_referrals — one immutable attribution per customer (first touch)
-- ---------------------------------------------------------------------------
create table if not exists public.affiliate_referrals (
  id                        uuid primary key default gen_random_uuid(),
  affiliate_id              uuid not null references public.affiliates (id) on delete cascade,
  customer_id               uuid not null references public.profiles (id) on delete cascade,
  referral_code             text not null,
  source                    text not null default 'link',
  visitor_id                text,
  status                    text not null default 'referred'
                            check (status in ('referred', 'active', 'canceled')),
  plan                      text,
  subscription_id           text,
  first_paid_at             timestamptz,
  commission_rate_pct       numeric(5, 2),
  commission_duration_months integer,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- Bir müşteri yalnızca BİR affiliate'e aittir; ilk dokunuş kazanır.
  constraint affiliate_referrals_customer_key unique (customer_id),
  constraint affiliate_referrals_rate_range check (commission_rate_pct >= 0 and commission_rate_pct <= 100)
);

comment on table public.affiliate_referrals is
  'First-touch referral attribution. customer_id is unique → a customer can never be re-attributed to another affiliate (prevents referral-code manipulation).';

create index if not exists affiliate_referrals_affiliate_idx
  on public.affiliate_referrals (affiliate_id, created_at desc);
create index if not exists affiliate_referrals_status_idx on public.affiliate_referrals (status);

-- ---------------------------------------------------------------------------
-- 3. affiliate_clicks — raw click tracking for link analytics
-- ---------------------------------------------------------------------------
create table if not exists public.affiliate_clicks (
  id                        uuid primary key default gen_random_uuid(),
  affiliate_id              uuid not null references public.affiliates (id) on delete cascade,
  visitor_key               text not null,
  referral_code             text not null,
  landing_path              text,
  created_at                timestamptz not null default now(),
  -- Aynı ziyaretçinin aynı partner linkini defalarca tıklaması tek click sayılır.
  constraint affiliate_clicks_visitor_key unique (affiliate_id, visitor_key)
);

create index if not exists affiliate_clicks_affiliate_idx on public.affiliate_clicks (affiliate_id);

-- ---------------------------------------------------------------------------
-- 4. commissions — append-only, idempotent per payment
-- ---------------------------------------------------------------------------
create table if not exists public.commissions (
  id                        uuid primary key default gen_random_uuid(),
  affiliate_id              uuid not null references public.affiliates (id) on delete cascade,
  customer_id               uuid not null references public.profiles (id) on delete cascade,
  subscription_id           text not null,
  payment_id                text not null,
  plan                      text not null,
  subscription_amount_cents integer not null,
  commission_rate_pct       numeric(5, 2) not null,
  commission_amount_cents   integer not null,
  currency                  text not null default 'USD',
  period_start              date not null,
  period_end                date not null,
  status                    text not null default 'pending'
                            check (status in ('pending', 'paid', 'reversed')),
  created_at                timestamptz not null default now(),
  paid_at                   timestamptz,
  reversed_at               timestamptz,
  reversed_reason           text,
  constraint commissions_amount_positive check (subscription_amount_cents >= 0 and commission_amount_cents >= 0),
  constraint commissions_rate_range check (commission_rate_pct >= 0 and commission_rate_pct <= 100),
  -- Webhook idempotency: aynı ödeme (transaction/invoice) iki kez komisyon üretemez.
  constraint commissions_payment_id_key unique (payment_id),
  -- Aynı müşteri + aynı dönem için ikinci bir komisyon asla oluşturulamaz.
  constraint commissions_period_key unique (affiliate_id, customer_id, period_start)
);

comment on table public.commissions is
  'Per-payment commission rows. Rows are never deleted: refund/chargeback flips status to reversed. payment_id uniqueness provides webhook idempotency at the row level.';

create index if not exists commissions_affiliate_status_idx
  on public.commissions (affiliate_id, status);
create index if not exists commissions_customer_idx on public.commissions (customer_id);
create index if not exists commissions_paid_at_idx on public.commissions (paid_at);
create index if not exists commissions_created_at_idx on public.commissions (created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at bakımı
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists affiliates_set_updated_at on public.affiliates;
create trigger affiliates_set_updated_at
  before update on public.affiliates
  for each row execute function public.set_updated_at();

drop trigger if exists affiliate_referrals_set_updated_at on public.affiliate_referrals;
create trigger affiliate_referrals_set_updated_at
  before update on public.affiliate_referrals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: tüm affiliate tabloları yalnızca sunucu (service role) üzerinden okunur/yazılır.
-- Doğrudan istemci erişimi (anon/authenticated) tamamen kapalıdır → partner'lar
-- birbirinin verisini asla doğrudan sorgulayamaz; her şey sunucu fonksiyonları
-- üzerinden ve affiliate_id kısıtıyla döner.
-- ---------------------------------------------------------------------------
alter table public.affiliates enable row level security;
alter table public.affiliate_referrals enable row level security;
alter table public.affiliate_clicks enable row level security;
alter table public.commissions enable row level security;

-- Varsayılan: hiçbir rol için policy yok → default deny.

-- ---------------------------------------------------------------------------
-- 5. Admin rolü: mk65449131@gmail.com
-- ---------------------------------------------------------------------------
-- mk65449131@gmail.com hesabına admin rolü verilir (varsa). Aynı e-posta ile
-- ileride açılacak yeni hesaplar için Supabase'deki is_admin_email allowlist
-- fonksiyonuna bu e-postayı eklemek yeterlidir; app tarafı rolü doğrular.
insert into public.user_roles (user_id, role)
select u.id, 'admin'
from auth.users u
where lower(u.email) = lower('mk65449131@gmail.com')
on conflict (user_id, role) do nothing;
