-- Asenkron arama işleri (QStash worker + frontend polling / Realtime)
create extension if not exists "pgcrypto";

create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  query text not null default '',
  status text not null default 'processing',
  params jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tablo daha önce başka bir şemayla oluşmuşsa eksik kolonları tamamla.
alter table public.searches add column if not exists query text not null default '';
alter table public.searches add column if not exists status text not null default 'processing';
alter table public.searches add column if not exists params jsonb not null default '{}'::jsonb;
alter table public.searches add column if not exists result jsonb;
alter table public.searches add column if not exists error text;
alter table public.searches add column if not exists created_at timestamptz not null default now();
alter table public.searches add column if not exists updated_at timestamptz not null default now();

do $$
begin
  alter table public.searches
    add constraint searches_status_check
    check (status in ('processing', 'completed', 'failed'));
exception
  when duplicate_object then null;
end $$;

create index if not exists searches_user_created_idx
  on public.searches (user_id, created_at desc);
create index if not exists searches_status_idx on public.searches (status);

alter table public.searches enable row level security;

-- Kullanıcı yalnızca kendi işlerini görür/günceller; servis rolü RLS'i bypass eder.
drop policy if exists "searches_select_own" on public.searches;
create policy "searches_select_own" on public.searches
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "searches_insert_own" on public.searches;
create policy "searches_insert_own" on public.searches
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "searches_update_own" on public.searches;
create policy "searches_update_own" on public.searches
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_searches_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists searches_touch_updated_at on public.searches;
create trigger searches_touch_updated_at
  before update on public.searches
  for each row execute function public.touch_searches_updated_at();

-- Realtime (postgres_changes) aboneliği için
alter table public.searches replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.searches;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
