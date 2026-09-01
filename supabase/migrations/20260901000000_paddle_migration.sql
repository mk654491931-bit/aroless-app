-- Migration: Lemon Squeezy → Paddle Billing v2
-- Adds Paddle columns and renames legacy Lemon Squeezy columns

-- 1. Add Paddle columns to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT,
ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT;

-- 2. Create indexes for Paddle columns
CREATE INDEX IF NOT EXISTS idx_paddle_subscription_id ON public.profiles(paddle_subscription_id);
CREATE INDEX IF NOT EXISTS idx_paddle_customer_id ON public.profiles(paddle_customer_id);

-- 3. Rename legacy Lemon Squeezy columns (if they exist) to indicate they're deprecated
-- We keep them for historical reference but new operations use Paddle columns
ALTER TABLE public.profiles 
RENAME COLUMN lemon_subscription_id TO legacy_lemon_subscription_id;
ALTER TABLE public.profiles 
RENAME COLUMN lemon_customer_id TO legacy_lemon_customer_id;

-- 4. Add comment to indicate migration status
COMMENT ON COLUMN public.profiles.paddle_subscription_id IS 'Paddle Billing v2 subscription ID';
COMMENT ON COLUMN public.profiles.paddle_customer_id IS 'Paddle Billing v2 customer ID';
COMMENT ON COLUMN public.profiles.legacy_lemon_subscription_id IS '[DEPRECATED] Old Lemon Squeezy subscription ID - use paddle_subscription_id';
COMMENT ON COLUMN public.profiles.legacy_lemon_customer_id IS '[DEPRECATED] Old Lemon Squeezy customer ID - use paddle_customer_id';
