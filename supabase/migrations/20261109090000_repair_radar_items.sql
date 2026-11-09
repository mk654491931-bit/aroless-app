-- ONARIM: production'da `radar_items` PostgREST şema önbelleğinde yoktu.
--
-- İlk migration (20260815222329) tabloyu oluşturuyordu; ortamda uygulanmamış
-- olduğu için `PUSH_FAILED:Could not find the table 'public.radar_items' in the
-- schema cache` alınıyordu. Bu dosya aynı şemayı IDEMPOTENT biçimde kurar:
-- tablo zaten varsa hiçbir veriyi silmez, eksik indeks/politika/yetkileri
-- tamamlar ve PostgREST'e şema önbelleğini yenilemesini söyler.
--
-- Uygulama sonrası Velora kazananları `radar_items`'a yazılır; migration
-- uygulanana kadar kod `ai_cache` kalıcı yedek kovanına yazar.

CREATE TABLE IF NOT EXISTS public.radar_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  title text NOT NULL,
  niche text NOT NULL DEFAULT 'General',
  category text NOT NULL DEFAULT 'General',
  country text NOT NULL DEFAULT 'US',
  platform text NOT NULL DEFAULT 'Shopify',
  winner_score integer NOT NULL DEFAULT 50,
  momentum integer NOT NULL DEFAULT 0,
  price_min numeric NOT NULL DEFAULT 0,
  price_max numeric NOT NULL DEFAULT 0,
  est_margin_pct numeric NOT NULL DEFAULT 0,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Eski/yarım kalmış tablolarda eksik kolon varsa tamamla.
ALTER TABLE public.radar_items ADD COLUMN IF NOT EXISTS day date;
ALTER TABLE public.radar_items ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.radar_items ADD COLUMN IF NOT EXISTS niche text;
ALTER TABLE public.radar_items ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.radar_items ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE public.radar_items ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE public.radar_items ADD COLUMN IF NOT EXISTS winner_score integer;
ALTER TABLE public.radar_items ADD COLUMN IF NOT EXISTS momentum integer;
ALTER TABLE public.radar_items ADD COLUMN IF NOT EXISTS price_min numeric;
ALTER TABLE public.radar_items ADD COLUMN IF NOT EXISTS price_max numeric;
ALTER TABLE public.radar_items ADD COLUMN IF NOT EXISTS est_margin_pct numeric;
ALTER TABLE public.radar_items ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.radar_items ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE public.radar_items ADD COLUMN IF NOT EXISTS created_at timestamptz;

CREATE INDEX IF NOT EXISTS radar_items_day_idx
  ON public.radar_items (day DESC, winner_score DESC);

CREATE UNIQUE INDEX IF NOT EXISTS radar_items_unique_day_title
  ON public.radar_items (day, country, lower(title));

GRANT SELECT ON public.radar_items TO authenticated;
GRANT ALL ON public.radar_items TO service_role;

ALTER TABLE public.radar_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'radar_items'
      AND policyname = 'Authenticated read radar'
  ) THEN
    CREATE POLICY "Authenticated read radar"
      ON public.radar_items FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'radar_items'
      AND policyname = 'Admins manage radar'
  ) THEN
    CREATE POLICY "Admins manage radar"
      ON public.radar_items FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), 'admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;

-- PostgREST yeni tabloyu hemen görsün; migration sonrası ilk istekte
-- "schema cache" hatasının tekrarlanmasını engeller.
NOTIFY pgrst, 'reload schema';
