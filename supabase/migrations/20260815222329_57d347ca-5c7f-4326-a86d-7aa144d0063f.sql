-- 1) Radar feed (daily generated, readable by all signed-in users)
CREATE TABLE public.radar_items (
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
CREATE INDEX radar_items_day_idx ON public.radar_items (day DESC, winner_score DESC);
CREATE UNIQUE INDEX radar_items_unique_day_title ON public.radar_items (day, country, lower(title));
GRANT SELECT ON public.radar_items TO authenticated;
GRANT ALL ON public.radar_items TO service_role;
ALTER TABLE public.radar_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read radar" ON public.radar_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage radar" ON public.radar_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) Real profit / ROI tracker
CREATE TABLE public.roi_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  platform text NOT NULL DEFAULT 'Shopify',
  country text NOT NULL DEFAULT 'US',
  currency text NOT NULL DEFAULT 'USD',
  cost_price numeric NOT NULL DEFAULT 0,
  sell_price numeric NOT NULL DEFAULT 0,
  shipping_cost numeric NOT NULL DEFAULT 0,
  other_cost numeric NOT NULL DEFAULT 0,
  ad_spend numeric NOT NULL DEFAULT 0,
  orders integer NOT NULL DEFAULT 0,
  refunds integer NOT NULL DEFAULT 0,
  expected_margin_pct numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX roi_entries_user_idx ON public.roi_entries (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roi_entries TO authenticated;
GRANT ALL ON public.roi_entries TO service_role;
ALTER TABLE public.roi_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own roi entries" ON public.roi_entries FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins view all roi entries" ON public.roi_entries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER roi_entries_updated_at BEFORE UPDATE ON public.roi_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) AI store audits
CREATE TABLE public.store_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url text NOT NULL,
  health_score integer NOT NULL DEFAULT 0,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_audits_user_idx ON public.store_audits (user_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.store_audits TO authenticated;
GRANT ALL ON public.store_audits TO service_role;
ALTER TABLE public.store_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own audits" ON public.store_audits FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own audits" ON public.store_audits FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own audits" ON public.store_audits FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins view all audits" ON public.store_audits FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4) Creative studio outputs
CREATE TABLE public.creative_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  platform text NOT NULL DEFAULT 'TikTok',
  language text NOT NULL DEFAULT 'tr',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creative_assets_user_idx ON public.creative_assets (user_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.creative_assets TO authenticated;
GRANT ALL ON public.creative_assets TO service_role;
ALTER TABLE public.creative_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own creative assets" ON public.creative_assets FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins view all creative assets" ON public.creative_assets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));