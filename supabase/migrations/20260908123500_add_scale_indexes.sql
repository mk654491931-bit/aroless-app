-- Scale-focused indexes for high-volume Paddle and affiliate flows.
-- Each index matches an existing query shape used by the current migrations.

-- Supports refund lookups by provider + external id ordered by newest row first:
--   SELECT ... FROM public.transactions
--   WHERE provider = 'paddle' AND external_id = _transaction_id
--   ORDER BY created_at DESC
--   LIMIT 1;
CREATE INDEX IF NOT EXISTS idx_transactions_provider_external_created
  ON public.transactions (provider, external_id, created_at DESC)
  WHERE external_id IS NOT NULL;

-- Supports refund reversal updates that target one transaction's unpaid accruals:
--   UPDATE public.commission_events
--   SET status = 'reversed'
--   WHERE paddle_transaction_id = _transaction_id
--     AND status <> 'paid';
CREATE INDEX IF NOT EXISTS idx_commission_events_transaction_status
  ON public.commission_events (paddle_transaction_id, status)
  WHERE status <> 'paid';

-- Supports alternate live-subscription lookup during cancellation / pause flows:
--   SELECT ... FROM public.subscriptions
--   WHERE user_id = _user_id
--     AND paddle_subscription_id IS DISTINCT FROM _paddle_subscription_id
--     AND status IN ('active', 'trialing')
--   ORDER BY updated_at DESC
--   LIMIT 1;
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status_updated
  ON public.subscriptions (user_id, status, updated_at DESC)
  WHERE status IN ('active', 'trialing');
