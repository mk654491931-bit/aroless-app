-- ============================================================================
-- Async Product Discovery jobs
--
-- Product Discovery used to run inside a single request, which is why the
-- Cloudflare edge answered `524 A Timeout Occurred` once the pipeline passed
-- 100s. The work now runs from a signed background worker, and this table is
-- the durable contract for it:
--
--   • `idempotency_key` (unique per user)  → replaying "start" can never create
--     a second job, so it can never charge a second credit.
--   • `claim_product_discovery_job()`      → atomic, retry-safe claim. A
--     duplicate QStash delivery, or a retry after the function was killed,
--     either gets `claimed = false` (terminal/alive lease) or safely re-claims
--     an expired lease. No double work, no corrupted state.
--   • `finish_product_discovery_job()`     → terminal write that refuses to
--     overwrite an already-terminal row.
--   • `refund_product_discovery_job()`     → refunds the spend exactly once,
--     only when the job was actually charged and later failed.
--
-- Transient progress lives in Redis (short TTL); this table stays the source
-- of truth and is never replaced by Redis.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.product_discovery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
  stage text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  engine text NOT NULL DEFAULT 'discovery',
  niche text NOT NULL,
  target_country text NOT NULL DEFAULT 'GLOBAL',
  -- Request parameters only. Never a token, never a credential.
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  -- `reserved` is the compare-and-swap result used by the API: only the replica
  -- that moved pending → reserved is allowed to spend a credit, so a double
  -- submit can never charge twice even if the row is reused.
  billing_state text NOT NULL DEFAULT 'pending'
    CHECK (billing_state IN ('pending', 'reserved', 'charged', 'refunded', 'skipped')),
  idempotency_key text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_discovery_jobs_idem_key UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_pd_jobs_user_created
  ON public.product_discovery_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pd_jobs_status
  ON public.product_discovery_jobs (status, created_at DESC);

ALTER TABLE public.product_discovery_jobs ENABLE ROW LEVEL SECURITY;

-- Owners can read their own jobs (the API additionally filters on user_id, and
-- returns 404 rather than 403 so a job id can never be probed).
DROP POLICY IF EXISTS pd_jobs_select_own ON public.product_discovery_jobs;
CREATE POLICY pd_jobs_select_own ON public.product_discovery_jobs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy on purpose: every write goes through the
-- service role behind the authenticated API routes.

-- ---------------------------------------------------------------------------
-- Atomic, idempotent claim
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_product_discovery_job(_job_id uuid)
RETURNS TABLE (claimed boolean, status text, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.product_discovery_jobs;
BEGIN
  SELECT * INTO _row
    FROM public.product_discovery_jobs
   WHERE id = _job_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'missing'::text, 0;
    RETURN;
  END IF;

  -- Terminal state → a duplicate delivery must do nothing at all.
  IF _row.status IN ('completed', 'failed', 'canceled') THEN
    RETURN QUERY SELECT false, _row.status, _row.attempts;
    RETURN;
  END IF;

  -- Another worker holds a live lease → skip (the holder will finish it).
  IF _row.locked_at IS NOT NULL AND _row.locked_at > now() - interval '10 minutes' THEN
    RETURN QUERY SELECT false, _row.status, _row.attempts;
    RETURN;
  END IF;

  UPDATE public.product_discovery_jobs
     SET status = 'running',
         locked_at = now(),
         attempts = attempts + 1,
         started_at = coalesce(started_at, now()),
         updated_at = now()
   WHERE id = _job_id;

  RETURN QUERY SELECT true, 'running'::text, _row.attempts + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_product_discovery_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_product_discovery_job(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Terminal write (refuses to overwrite an already-terminal row)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_product_discovery_job(
  _job_id uuid,
  _status text,
  _result jsonb DEFAULT NULL,
  _error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated integer;
BEGIN
  IF _status NOT IN ('completed', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'invalid terminal status: %', _status;
  END IF;

  UPDATE public.product_discovery_jobs
     SET status = _status,
         result = coalesce(_result, result),
         error = _error,
         progress = CASE WHEN _status = 'completed' THEN 100 ELSE progress END,
         finished_at = now(),
         locked_at = NULL,
         updated_at = now()
   WHERE id = _job_id
     AND status NOT IN ('completed', 'failed', 'canceled');

  GET DIAGNOSTICS _updated = ROW_COUNT;
  RETURN _updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_product_discovery_job(uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_product_discovery_job(uuid, text, jsonb, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Refund exactly once (only when the job really was charged)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_product_discovery_job(_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
BEGIN
  UPDATE public.product_discovery_jobs
     SET billing_state = 'refunded',
         updated_at = now()
   WHERE id = _job_id
     AND billing_state = 'charged'
  RETURNING user_id INTO _uid;

  IF _uid IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.profiles
     SET credits = coalesce(credits, 0) + 1
   WHERE id = _uid;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_product_discovery_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_product_discovery_job(uuid) TO service_role;
