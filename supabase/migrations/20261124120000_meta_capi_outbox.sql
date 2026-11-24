-- ============================================================================
-- META CONVERSIONS API — KALICI OUTBOX + İZİNLİ ATTRIBUTION
--
-- NEDEN VAR (ölçülen risk): `Purchase` sunucudan tek bir `fetch` ile
-- gönderiliyordu. Meta 5xx/429 döndüğünde ya da ağ koptuğunda olay KAYBOLUYORDU;
-- webhook yine 200 döndüğü için Paddle tekrar denemiyordu. Ciro ölçümü sessizce
-- eksik kalıyordu.
--
-- ÇÖZÜM: olay önce veritabanına yazılır (outbox), sonra gönderilir. Başarısız
-- gönderim üstel geri çekilmeyle yeniden denenir. Tekilleştirme iki katmanlıdır:
--   1. `event_id` UNIQUE → aynı Paddle işlemi için ikinci satır AÇILMAZ.
--   2. Meta'ya giden `event_id` aynıdır → yeniden deneme çift `Purchase`
--      saymaz (Meta aynı `event_name` + `event_id` çiftini tekilleştirir).
--
-- 46 SAAT SINIRI: Meta'nın tekilleştirme penceresi sınırlıdır. Bu pencerenin
-- dışına taşan yeniden denemeler çift sayım riski taşıdığı için kayıt
-- `failed` işaretlenir ve GÖNDERİLMEZ (sessizce kaybolmaz; hata adıyla görünür).
--
-- ATTRIBUTION TABLOSU: `fbp`/`fbc`/istemci IP/user-agent yalnızca pazarlama
-- izni VERİLDİĞİNDE checkout anında yazılır, Purchase gönderilirken okunur ve
-- 7 gün sonra silinir. Paddle `customData` içine kişisel veri konmaz; yenileme
-- işlemlerine kopyalanan bu alan reklam eşleştirmesi için yanıltıcı olurdu.
--
-- GÜVENLİK: iki tablo da RLS açık ve yalnız `service_role` erişebilir; anon ve
-- authenticated rollerine HİÇBİR yetki verilmez. RPC'ler `security definer`
-- olup search_path sabittir.
-- ============================================================================

-- 1) OUTBOX ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meta_capi_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  event_name text NOT NULL,
  -- Gönderilecek olay girdisi (e-posta/kullanıcı kimliği ÖZETLENMİŞ hâlde
  -- değil, ham hâlde saklanır; özetleme gönderim anında yapılır ve ham değer
  -- hiçbir zaman Meta'ya gitmez). RLS sayesinde yalnız sunucu okur.
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_capi_outbox_event_id_key UNIQUE (event_id),
  CONSTRAINT meta_capi_outbox_status_check CHECK (
    status IN ('pending', 'processing', 'sent', 'failed')
  ),
  CONSTRAINT meta_capi_outbox_attempts_check CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS meta_capi_outbox_due_idx
  ON public.meta_capi_outbox (status, next_attempt_at);

ALTER TABLE public.meta_capi_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.meta_capi_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_capi_outbox TO service_role;

COMMENT ON TABLE public.meta_capi_outbox IS
  'Meta Conversions API kuyruğu: event_id UNIQUE ile idempotent, üstel geri çekilmeli retry.';
COMMENT ON COLUMN public.meta_capi_outbox.event_id IS
  'Meta event_id (purchase-<Paddle txn>). Aynı işlem için ikinci satır açılmaz.';
COMMENT ON COLUMN public.meta_capi_outbox.payload IS
  'Gönderim anında SHA-256 ile özetlenen olay girdisi. Yalnız service_role erişir.';

-- 2) CHECKOUT ANI ATTRIBUTION (yalnız açık pazarlama izniyle) --------------
CREATE TABLE IF NOT EXISTS public.meta_capi_attribution (
  transaction_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fbp text,
  fbc text,
  client_ip text,
  client_user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_capi_attribution_fbp_len CHECK (fbp IS NULL OR char_length(fbp) <= 320),
  CONSTRAINT meta_capi_attribution_fbc_len CHECK (fbc IS NULL OR char_length(fbc) <= 320),
  CONSTRAINT meta_capi_attribution_ip_len CHECK (client_ip IS NULL OR char_length(client_ip) <= 64),
  CONSTRAINT meta_capi_attribution_ua_len CHECK (
    client_user_agent IS NULL OR char_length(client_user_agent) <= 500
  )
);

CREATE INDEX IF NOT EXISTS meta_capi_attribution_created_idx
  ON public.meta_capi_attribution (created_at);

ALTER TABLE public.meta_capi_attribution ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.meta_capi_attribution FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_capi_attribution TO service_role;

COMMENT ON TABLE public.meta_capi_attribution IS
  'Checkout anında açık pazarlama izniyle toplanan Meta eşleştirme verisi; 7 gün sonra silinir.';

-- 3) IDEMPOTENT ENQUEUE ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_meta_capi_event(
  _event_id text,
  _event_name text,
  _payload jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _event_id IS NULL OR length(trim(_event_id)) = 0 THEN
    RAISE EXCEPTION 'event_id zorunlu';
  END IF;
  IF _event_name IS NULL OR length(trim(_event_name)) = 0 THEN
    RAISE EXCEPTION 'event_name zorunlu';
  END IF;
  IF _payload IS NULL THEN
    RAISE EXCEPTION 'payload zorunlu';
  END IF;

  INSERT INTO public.meta_capi_outbox (event_id, event_name, payload)
  VALUES (trim(_event_id), trim(_event_name), _payload)
  ON CONFLICT (event_id) DO NOTHING;

  -- `FOUND`, ON CONFLICT DO NOTHING sonrası yalnız GERÇEKTEN satır
  -- eklendiyse true olur → aynı işlem iki kez kuyruğa girmez.
  IF FOUND THEN
    RETURN 'enqueued';
  END IF;
  RETURN 'duplicate';
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_meta_capi_event(text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_meta_capi_event(text, text, jsonb)
  TO service_role;

-- 4) ATOMİK SAHİPLENME (SKIP LOCKED) --------------------------------------
CREATE OR REPLACE FUNCTION public.claim_meta_capi_outbox(
  _limit integer DEFAULT 20,
  _event_id text DEFAULT NULL
)
RETURNS SETOF public.meta_capi_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _now timestamptz := now();
BEGIN
  -- Meta'nın tekilleştirme penceresi dışına çıkan kayıtlar GÖNDERİLMEZ.
  -- Sessiz silme yok: `failed` olarak işaretlenir ve hata adı görünür kalır.
  UPDATE public.meta_capi_outbox
     SET status = 'failed',
         last_error = COALESCE(last_error, 'expired_dedup_window'),
         updated_at = _now
   WHERE status IN ('pending', 'processing')
     AND created_at < _now - interval '46 hours';

  -- Çöken bir işçinin 'processing' bıraktığı satır geri alınır. Aksi hâlde
  -- tek bir süreç ölümü olayı sonsuza kadar kilitleyebilirdi.
  UPDATE public.meta_capi_outbox
     SET status = 'pending',
         updated_at = _now
   WHERE status = 'processing'
     AND last_attempt_at < _now - interval '10 minutes';

  RETURN QUERY
  WITH picked AS (
    SELECT id
      FROM public.meta_capi_outbox
     WHERE status = 'pending'
       AND next_attempt_at <= _now
       AND (_event_id IS NULL OR event_id = _event_id)
     ORDER BY next_attempt_at, created_at
     LIMIT GREATEST(1, LEAST(COALESCE(_limit, 20), 100))
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.meta_capi_outbox o
       SET status = 'processing',
           attempts = o.attempts + 1,
           last_attempt_at = _now,
           updated_at = _now
      FROM picked
     WHERE o.id = picked.id
     RETURNING o.*
  )
  SELECT * FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_meta_capi_outbox(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_meta_capi_outbox(integer, text)
  TO service_role;

-- 5) GÖNDERİM SONUCU -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_meta_capi_outbox(
  _id uuid,
  _status text,
  _error text DEFAULT NULL,
  _next_attempt_at timestamptz DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _attempts integer;
  _max integer;
BEGIN
  SELECT attempts, max_attempts
    INTO _attempts, _max
    FROM public.meta_capi_outbox
   WHERE id = _id;

  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;

  IF _status = 'sent' THEN
    UPDATE public.meta_capi_outbox
       SET status = 'sent',
           sent_at = now(),
           last_error = NULL,
           next_attempt_at = now(),
           updated_at = now()
     WHERE id = _id;
    RETURN 'sent';
  END IF;

  -- Kalıcı hata (4xx), deneme tavanı ya da 46 saat penceresi → tekrar YOK.
  IF _status = 'dead' OR _attempts >= _max THEN
    UPDATE public.meta_capi_outbox
       SET status = 'failed',
           last_error = left(COALESCE(_error, 'unknown'), 500),
           next_attempt_at = now(),
           updated_at = now()
     WHERE id = _id;
    RETURN 'dead';
  END IF;

  UPDATE public.meta_capi_outbox
     SET status = 'pending',
         last_error = left(COALESCE(_error, 'unknown'), 500),
         next_attempt_at = COALESCE(_next_attempt_at, now() + interval '1 minute'),
         updated_at = now()
   WHERE id = _id;
  RETURN 'retry';
END;
$$;

REVOKE ALL ON FUNCTION public.finish_meta_capi_outbox(uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_meta_capi_outbox(uuid, text, text, timestamptz)
  TO service_role;

-- 6) TEMİZLİK / SAKLAMA SINIRI --------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_meta_capi_outbox()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _events integer := 0;
  _attribution integer := 0;
BEGIN
  -- Gönderilmiş/başarısız olaylar 30 gün; izinli eşleştirme verisi 7 gün.
  DELETE FROM public.meta_capi_outbox
   WHERE status IN ('sent', 'failed')
     AND updated_at < now() - interval '30 days';
  GET DIAGNOSTICS _events = ROW_COUNT;

  DELETE FROM public.meta_capi_attribution
   WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS _attribution = ROW_COUNT;

  RETURN jsonb_build_object('events', _events, 'attribution', _attribution);
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_meta_capi_outbox()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_meta_capi_outbox()
  TO service_role;

COMMENT ON FUNCTION public.cleanup_meta_capi_outbox() IS
  'Outbox kayıtlarını 30, izinli attribution kayıtlarını 7 gün sonra siler (saklama sınırı).';
