-- Reliable QStash search jobs: leases, retry state, message identity and
-- idempotent credit charging/refunding.
--
-- The worker is intentionally the only caller of the lease/settlement RPCs;
-- service_role executes them with RLS bypass. The credit RPC is callable by an
-- authenticated user JWT so auth.uid() remains the source of truth.

ALTER TABLE public.searches
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS qstash_message_id text,
  ADD COLUMN IF NOT EXISTS credit_charged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_source text,
  ADD COLUMN IF NOT EXISTS credit_refunded boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS searches_processing_lease_idx
  ON public.searches (status, locked_until)
  WHERE status = 'processing';
CREATE UNIQUE INDEX IF NOT EXISTS searches_qstash_message_id_key
  ON public.searches (qstash_message_id)
  WHERE qstash_message_id IS NOT NULL;

-- Atomically claim one delivery. A live lease means another delivery is
-- already running; an expired lease makes the job recoverable after a crash.
CREATE OR REPLACE FUNCTION public.claim_search_job(
  _job_id uuid,
  _lease_seconds integer DEFAULT 900
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed public.searches%ROWTYPE;
  existing public.searches%ROWTYPE;
  lease_seconds integer := LEAST(GREATEST(COALESCE(_lease_seconds, 900), 30), 3600);
BEGIN
  UPDATE public.searches
  SET
    attempt_count = attempt_count + 1,
    locked_until = now() + make_interval(secs => lease_seconds),
    last_attempt_at = now(),
    updated_at = now()
  WHERE id = _job_id
    AND status = 'processing'
    AND (locked_until IS NULL OR locked_until <= now())
  RETURNING * INTO claimed;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'state', 'claimed',
      'status', claimed.status,
      'attempt_count', claimed.attempt_count,
      'user_id', claimed.user_id
    );
  END IF;

  SELECT * INTO existing FROM public.searches WHERE id = _job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'missing');
  END IF;

  IF existing.status = 'completed' THEN
    RETURN jsonb_build_object(
      'state', 'completed',
      'status', existing.status,
      'attempt_count', existing.attempt_count,
      'user_id', existing.user_id
    );
  ELSIF existing.status = 'failed' THEN
    RETURN jsonb_build_object(
      'state', 'failed',
      'status', existing.status,
      'attempt_count', existing.attempt_count,
      'user_id', existing.user_id
    );
  END IF;

  RETURN jsonb_build_object(
    'state', 'processing',
    'status', existing.status,
    'attempt_count', existing.attempt_count,
    'user_id', existing.user_id
  );
END;
$$;

-- Release the lease before returning a retryable non-2xx response. The
-- attempt guard prevents an older delivery from unlocking a newer delivery.
CREATE OR REPLACE FUNCTION public.release_search_job(
  _job_id uuid,
  _attempt_count integer,
  _error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE changed boolean;
BEGIN
  UPDATE public.searches
  SET
    status = 'processing',
    locked_until = NULL,
    error = CASE WHEN _error IS NULL THEN error ELSE left(_error, 2000) END,
    updated_at = now()
  WHERE id = _job_id
    AND status = 'processing'
    AND attempt_count = _attempt_count;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_search_job(
  _job_id uuid,
  _attempt_count integer,
  _error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE changed boolean;
BEGIN
  UPDATE public.searches
  SET
    status = 'failed',
    locked_until = NULL,
    error = left(COALESCE(_error, 'Worker failed'), 2000),
    updated_at = now()
  WHERE id = _job_id
    AND status = 'processing'
    AND attempt_count = _attempt_count;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

-- Completion is also claim-scoped. If another delivery already completed the
-- job, the operation is idempotently successful; otherwise a lost lease is a
-- deliberate error and the caller can let QStash retry.
CREATE OR REPLACE FUNCTION public.complete_search_job(
  _job_id uuid,
  _attempt_count integer,
  _result jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE changed boolean;
DECLARE current_status text;
BEGIN
  UPDATE public.searches
  SET
    status = 'completed',
    locked_until = NULL,
    result = _result,
    error = NULL,
    updated_at = now()
  WHERE id = _job_id
    AND status = 'processing'
    AND attempt_count = _attempt_count;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed THEN RETURN true; END IF;

  SELECT status INTO current_status FROM public.searches WHERE id = _job_id;
  RETURN current_status = 'completed';
END;
$$;

-- A job retry must never charge the same user twice. The first call records
-- whether the debit came from finder_credits or paid/general credits.
CREATE OR REPLACE FUNCTION public.deduct_product_finder_credit_for_job(_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job_user uuid;
  already_charged boolean;
  already_refunded boolean;
  source text;
  remaining integer;
BEGIN
  SELECT user_id, credit_charged, credit_refunded
    INTO job_user, already_charged, already_refunded
  FROM public.searches
  WHERE id = _job_id AND user_id = auth.uid()
  FOR UPDATE;

  IF job_user IS NULL THEN RAISE EXCEPTION 'search_job_not_found'; END IF;
  IF already_charged AND NOT already_refunded THEN
    SELECT CASE WHEN credit_source = 'finder' THEN finder_credits ELSE credits END
      INTO remaining
    FROM public.searches s
    JOIN public.profiles p ON p.id = s.user_id
    WHERE s.id = _job_id;
    RETURN COALESCE(remaining, 0);
  END IF;
  IF already_refunded THEN RAISE EXCEPTION 'search_job_credit_refunded'; END IF;

  UPDATE public.profiles
  SET finder_credits = finder_credits - 1,
      credits_spent = credits_spent + 1,
      updated_at = now()
  WHERE id = auth.uid() AND finder_credits > 0
  RETURNING finder_credits INTO remaining;
  IF remaining IS NOT NULL THEN
    source := 'finder';
  ELSE
    UPDATE public.profiles
    SET credits = credits - 1,
        credits_spent = credits_spent + 1,
        updated_at = now()
    WHERE id = auth.uid() AND credits > 0
    RETURNING credits INTO remaining;
    IF remaining IS NULL THEN RAISE EXCEPTION 'no_credits'; END IF;
    source := 'credits';
  END IF;

  UPDATE public.searches
  SET credit_charged = true,
      credit_source = source,
      credit_refunded = false,
      updated_at = now()
  WHERE id = _job_id AND user_id = auth.uid();
  RETURN remaining;
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_product_finder_credit_for_job(_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source text;
  already_charged boolean;
  already_refunded boolean;
  remaining integer;
BEGIN
  SELECT credit_source, credit_charged, credit_refunded
    INTO source, already_charged, already_refunded
  FROM public.searches
  WHERE id = _job_id AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT already_charged OR already_refunded THEN
    SELECT finder_credits INTO remaining FROM public.profiles WHERE id = auth.uid();
    RETURN COALESCE(remaining, 0);
  END IF;

  IF source = 'finder' THEN
    UPDATE public.profiles
    SET finder_credits = finder_credits + 1,
        credits_spent = GREATEST(0, credits_spent - 1),
        updated_at = now()
    WHERE id = auth.uid()
    RETURNING finder_credits INTO remaining;
  ELSE
    UPDATE public.profiles
    SET credits = credits + 1,
        credits_spent = GREATEST(0, credits_spent - 1),
        updated_at = now()
    WHERE id = auth.uid()
    RETURNING credits INTO remaining;
  END IF;

  UPDATE public.searches
  SET credit_refunded = true,
      updated_at = now()
  WHERE id = _job_id AND user_id = auth.uid();
  RETURN COALESCE(remaining, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_search_job(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_search_job(uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_search_job(uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_search_job(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_search_job(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_search_job(uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_search_job(uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_search_job(uuid, integer, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.deduct_product_finder_credit_for_job(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refund_product_finder_credit_for_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deduct_product_finder_credit_for_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_product_finder_credit_for_job(uuid) TO authenticated;
