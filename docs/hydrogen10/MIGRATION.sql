-- ============================================================================
-- HIDROJEN10 — MVP VERİTABANI MIGRATION'I
--
-- KULLANIM: Supabase Dashboard → SQL Editor → bu dosyanın tamamını yapıştır →
--           Run. Migration uygulama tarafından OTOMATİK ÇALIŞTIRILMAZ.
--
-- Kapsam:
--   • Global niş cache'i (ülke + platform + para birimi ayrı niş)
--   • Kanonik ürün kimliği
--   • Güncel teklifler
--   • Her kazımayı saklayan append-only gözlemler
--   • Ürün olmayan/geçersiz ham satırların da saklandığı ingest arşivi
--   • Kaynak sağlığı / run geçmişi
--
-- Tasarım notları:
--   • Ortak cache tabloları istemciye açılmaz; yalnız service role/server
--     function erişir. RLS açılır ve policy EKLENMEZ.
--   • Yerel fiyat yapılandırılmış olarak geliyorsa en küçük birimde tam sayı
--     tutulur; gelmiyorsa NULL kalır. USD normalize ayrı alandadır.
--   • `h10_observations` ve `h10_ingest_rows` append-only'dir; UPDATE/DELETE
--     akışı yoktur.
--   • Bir niş için aynı anda yalnız bir aktif run olabilir.
--   • Uygulama kaynakları `h10_sources` tablosuna upsert eder; kaynak
--     politikaları (`cache_allowed`, `retention_days`) burada tutulur.
-- ============================================================================

begin;

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Kaynak politikaları
-- ----------------------------------------------------------------------------

create table if not exists public.h10_sources (
  source text primary key,
  display_name text not null,
  cache_allowed boolean not null default true,
  retention_days integer not null default 180
    check (retention_days between 1 and 3650),
  attribution_required boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint h10_sources_source_format
    check (source ~ '^[a-z0-9_]+$')
);

comment on table public.h10_sources is
  'Hidrojen10 kaynak politikaları: lisans, cache ve saklama süresi.';

-- ----------------------------------------------------------------------------
-- 2. Global niş cache'i
-- ----------------------------------------------------------------------------

create table if not exists public.h10_niches (
  id uuid primary key default gen_random_uuid(),
  canonical_key text not null unique,
  query text not null,
  query_normalized text not null,
  country text not null,
  platform text not null,
  currency text not null,
  schema_version integer not null default 1
    check (schema_version > 0),
  status text not null default 'empty'
    check (status in ('empty', 'queued', 'scraping', 'ready', 'partial', 'failed')),
  last_scraped_at timestamptz,
  fresh_until timestamptz,
  next_refresh_at timestamptz,
  row_count integer not null default 0
    check (row_count >= 0),
  source_stats jsonb not null default '[]'::jsonb
    check (jsonb_typeof(source_stats) = 'array'),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint h10_niches_query_not_blank
    check (length(btrim(query)) > 0),
  constraint h10_niches_country_format
    check (country ~ '^[A-Z]{2}$'),
  constraint h10_niches_platform_format
    check (platform ~ '^[a-z0-9_]+$'),
  constraint h10_niches_currency_format
    check (currency ~ '^[A-Z]{3}$')
);

comment on table public.h10_niches is
  'Global niş cache anahtarı. Aynı niş+filtre kazıma başlatmaz.';

create index if not exists h10_niches_refresh_idx
  on public.h10_niches (next_refresh_at)
  where status in ('ready', 'partial');

create index if not exists h10_niches_market_idx
  on public.h10_niches (country, platform);

-- ----------------------------------------------------------------------------
-- 3. Kanonik ürünler
-- ----------------------------------------------------------------------------

create table if not exists public.h10_products (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null unique,
  fingerprint text not null,
  gtin text,
  mpn text,
  brand text not null default '',
  title text not null,
  image_url text not null default '',
  category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  constraint h10_products_identity_key_not_blank
    check (length(btrim(identity_key)) > 0),
  constraint h10_products_title_not_blank
    check (length(btrim(title)) > 0)
);

comment on table public.h10_products is
  'Pazaryerinden bağımsız kanonik ürün kimliği. Satıcı ürün kimliğine girmez.';

create index if not exists h10_products_gtin_idx
  on public.h10_products (gtin)
  where gtin is not null and gtin <> '';

create index if not exists h10_products_brand_mpn_idx
  on public.h10_products (brand, mpn)
  where mpn is not null and mpn <> '';

-- ----------------------------------------------------------------------------
-- 4. Kazıma run'ları
-- ----------------------------------------------------------------------------

create table if not exists public.h10_runs (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid not null references public.h10_niches (id) on delete restrict,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'partial', 'failed')),
  triggered_by text not null default 'user'
    check (triggered_by in ('user', 'stale_refresh', 'manual', 'cron', 'watchlist')),
  dedupe_key text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  row_count integer not null default 0
    check (row_count >= 0),
  source_stats jsonb not null default '[]'::jsonb
    check (jsonb_typeof(source_stats) = 'array'),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.h10_runs is
  'Bir niş için tek kazıma işi. Aktif run tekliliği partial unique index ile korunur.';

create unique index if not exists h10_runs_one_active_per_niche_idx
  on public.h10_runs (niche_id)
  where status in ('queued', 'running');

create index if not exists h10_runs_niche_created_idx
  on public.h10_runs (niche_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 5. Kaynak bazlı run sonuçları
-- ----------------------------------------------------------------------------

create table if not exists public.h10_source_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.h10_runs (id) on delete restrict,
  source text not null,
  status text not null
    check (status in ('ok', 'no_results', 'partial', 'not_configured', 'failed')),
  items integer not null default 0
    check (items >= 0),
  invalid_items integer not null default 0
    check (invalid_items >= 0),
  latency_ms integer not null default 0
    check (latency_ms >= 0),
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint h10_source_runs_source_format
    check (source ~ '^[a-z0-9_]+$'),
  unique (run_id, source)
);

comment on table public.h10_source_runs is
  'Kaynak sağlığı: hangi kaynak çalıştı, hangisi çöktü, hangisi yapılandırılmadı.';

create index if not exists h10_source_runs_run_idx
  on public.h10_source_runs (run_id);

create index if not exists h10_source_runs_failed_idx
  on public.h10_source_runs (created_at desc)
  where status in ('failed', 'partial');

-- ----------------------------------------------------------------------------
-- 6. Güncel teklifler
-- ----------------------------------------------------------------------------

create table if not exists public.h10_offers (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid not null references public.h10_niches (id) on delete restrict,
  product_id uuid not null references public.h10_products (id) on delete restrict,
  source text not null,
  seller text not null default '',
  source_item_id text,
  currency text not null,
  price_local_minor bigint
    check (price_local_minor is null or price_local_minor >= 0),
  price_usd numeric(14, 2)
    check (price_usd is null or price_usd >= 0),
  fx_rate numeric(18, 8)
    check (fx_rate is null or fx_rate > 0),
  fx_at timestamptz,
  rating numeric(3, 2)
    check (rating is null or (rating >= 0 and rating <= 5)),
  rating_count integer
    check (rating_count is null or rating_count >= 0),
  in_stock boolean,
  source_url text not null default '',
  evidence text not null default 'measured'
    check (evidence in ('measured', 'derived', 'estimated')),
  observed_at timestamptz not null default now(),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint h10_offers_source_format
    check (source ~ '^[a-z0-9_]+$'),
  constraint h10_offers_currency_format
    check (currency ~ '^[A-Z]{3}$'),
  unique (niche_id, product_id, source)
);

comment on table public.h10_offers is
  'Bir ürünün bir kaynaktaki güncel teklifi. Geçmiş h10_observations içindedir.';

create index if not exists h10_offers_niche_price_idx
  on public.h10_offers (niche_id, price_usd);

create index if not exists h10_offers_niche_rating_idx
  on public.h10_offers (niche_id, rating desc nulls last);

create index if not exists h10_offers_niche_stock_idx
  on public.h10_offers (niche_id, in_stock);

create index if not exists h10_offers_product_idx
  on public.h10_offers (product_id);

-- ----------------------------------------------------------------------------
-- 7. Append-only gözlemler (ürünle eşleşen her kazınan satır)
-- ----------------------------------------------------------------------------

create table if not exists public.h10_observations (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.h10_runs (id) on delete restrict,
  niche_id uuid not null references public.h10_niches (id) on delete restrict,
  product_id uuid not null references public.h10_products (id) on delete restrict,
  source text not null,
  seller text not null default '',
  source_item_id text,
  currency text not null,
  price_local_minor bigint
    check (price_local_minor is null or price_local_minor >= 0),
  price_usd numeric(14, 2)
    check (price_usd is null or price_usd >= 0),
  fx_rate numeric(18, 8)
    check (fx_rate is null or fx_rate > 0),
  fx_at timestamptz,
  rating numeric(3, 2)
    check (rating is null or (rating >= 0 and rating <= 5)),
  rating_count integer
    check (rating_count is null or rating_count >= 0),
  in_stock boolean,
  source_url text not null default '',
  evidence text not null default 'measured'
    check (evidence in ('measured', 'derived', 'estimated')),
  eligible boolean not null default true,
  rejection_reason text,
  changed boolean not null default false,
  raw_hash text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint h10_observations_source_format
    check (source ~ '^[a-z0-9_]+$'),
  constraint h10_observations_currency_format
    check (currency ~ '^[A-Z]{3}$')
);

comment on table public.h10_observations is
  'Append-only kazıma gözlemleri. Filtreye takılan ürün satırları da burada tutulur.';

create index if not exists h10_observations_niche_time_idx
  on public.h10_observations (niche_id, observed_at desc);

create index if not exists h10_observations_run_idx
  on public.h10_observations (run_id);

create index if not exists h10_observations_product_time_idx
  on public.h10_observations (product_id, observed_at desc);

-- ----------------------------------------------------------------------------
-- 8. Ham ingest arşivi (ürün olmayan/geçersiz satırlar dahil HER satır)
-- ----------------------------------------------------------------------------

create table if not exists public.h10_ingest_rows (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.h10_runs (id) on delete restrict,
  niche_id uuid not null references public.h10_niches (id) on delete restrict,
  source text not null,
  title text not null default '',
  source_item_id text,
  source_url text not null default '',
  currency text not null,
  price_usd numeric(14, 2)
    check (price_usd is null or price_usd >= 0),
  eligible boolean not null default false,
  rejection_reason text,
  raw_hash text,
  raw jsonb not null default '{}'::jsonb
    check (jsonb_typeof(raw) = 'object'),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint h10_ingest_rows_source_format
    check (source ~ '^[a-z0-9_]+$'),
  constraint h10_ingest_rows_currency_format
    check (currency ~ '^[A-Z]{3}$')
);

comment on table public.h10_ingest_rows is
  'Append-only ham satır arşivi: ürün olmayan, başlıksız veya normalize edilemeyen satırlar dahil.';

create index if not exists h10_ingest_rows_niche_time_idx
  on public.h10_ingest_rows (niche_id, observed_at desc);

create index if not exists h10_ingest_rows_run_idx
  on public.h10_ingest_rows (run_id);

create index if not exists h10_ingest_rows_rejected_idx
  on public.h10_ingest_rows (niche_id, observed_at desc)
  where eligible = false;

-- ----------------------------------------------------------------------------
-- 9. updated_at trigger'ları
-- ----------------------------------------------------------------------------

create or replace function public.h10_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists h10_sources_touch_updated_at on public.h10_sources;
create trigger h10_sources_touch_updated_at
  before update on public.h10_sources
  for each row execute function public.h10_touch_updated_at();

drop trigger if exists h10_niches_touch_updated_at on public.h10_niches;
create trigger h10_niches_touch_updated_at
  before update on public.h10_niches
  for each row execute function public.h10_touch_updated_at();

drop trigger if exists h10_products_touch_updated_at on public.h10_products;
create trigger h10_products_touch_updated_at
  before update on public.h10_products
  for each row execute function public.h10_touch_updated_at();

drop trigger if exists h10_runs_touch_updated_at on public.h10_runs;
create trigger h10_runs_touch_updated_at
  before update on public.h10_runs
  for each row execute function public.h10_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 10. RLS: ortak cache yalnız sunucu tarafından erişilir
-- ----------------------------------------------------------------------------

alter table public.h10_sources enable row level security;
alter table public.h10_niches enable row level security;
alter table public.h10_products enable row level security;
alter table public.h10_runs enable row level security;
alter table public.h10_source_runs enable row level security;
alter table public.h10_offers enable row level security;
alter table public.h10_observations enable row level security;
alter table public.h10_ingest_rows enable row level security;

-- Bilinçli olarak policy EKLENMİYOR:
--   • anon/authenticated doğrudan okuma/yazma yapamaz.
--   • server function'lar service_role ile çalışır; service_role RLS'i bypass eder.
--   • Watchlist/alarm tabloları ileride user_id + RLS ile ayrı migration'da gelir.

-- Service role için açık tablo/sequence yetkileri (RLS bypass ayrıdır).
-- Append-only tablolarda UPDATE/DELETE yetkisi VERİLMEZ.
grant usage on schema public to service_role;
grant select, insert, update on public.h10_sources to service_role;
grant select, insert, update on public.h10_niches to service_role;
grant select, insert, update on public.h10_products to service_role;
grant select, insert, update on public.h10_runs to service_role;
grant select, insert on public.h10_source_runs to service_role;
grant select, insert, update, delete on public.h10_offers to service_role;
grant select, insert on public.h10_observations to service_role;
grant select, insert on public.h10_ingest_rows to service_role;
grant usage, select on sequence public.h10_observations_id_seq to service_role;
grant usage, select on sequence public.h10_ingest_rows_id_seq to service_role;

commit;
