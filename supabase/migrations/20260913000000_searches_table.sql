-- ============================================================================
-- Searches table for async Publish-Poll search pipeline
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  niche text,
  payload jsonb DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_searches_user_created
  ON public.searches (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_searches_status
  ON public.searches (status, created_at DESC);

ALTER TABLE public.searches ENABLE ROW LEVEL SECURITY;

-- Allow users to select their own search records (or unauthenticated/anonymous searches)
DROP POLICY IF EXISTS searches_select_own ON public.searches;
CREATE POLICY searches_select_own ON public.searches
  FOR SELECT TO authenticated, anon
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Allow inserting search records
DROP POLICY IF EXISTS searches_insert_own ON public.searches;
CREATE POLICY searches_insert_own ON public.searches
  FOR INSERT TO authenticated, anon
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Allow updating search records
DROP POLICY IF EXISTS searches_update_own ON public.searches;
CREATE POLICY searches_update_own ON public.searches
  FOR UPDATE TO authenticated, anon
  USING (auth.uid() = user_id OR user_id IS NULL);
