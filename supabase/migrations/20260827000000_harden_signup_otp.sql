-- Prevent successful OTP verification from being replayed concurrently.
CREATE INDEX IF NOT EXISTS idx_email_otps_active_lookup
  ON public.email_otps (id, code_hash)
  WHERE consumed_at IS NULL;