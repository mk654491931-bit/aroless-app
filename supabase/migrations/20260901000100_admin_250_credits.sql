-- Migration: Admin users get 250 credits on signup
-- Designated admin users (fixed list + @aroless.com domain) receive 250 initial credits

-- Add admin_credits column to track admin grant status
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS admin_credits_granted BOOLEAN DEFAULT false;

-- Create function to determine initial credits based on admin status
CREATE OR REPLACE FUNCTION public.get_initial_credits(_email text)
RETURNS integer LANGUAGE plpgsql STABLE
AS $$
DECLARE
  normalized_email text;
  aroless_count integer;
BEGIN
  -- Normalize email
  normalized_email := lower(btrim(coalesce(_email, '')));
  
  -- Check fixed admin list (returns 250 credits)
  IF normalized_email IN (
    'mryetenek@gmail.com',
    'mk654491931@gmail.com',
    'omnic.111111@gmail.com',
    'mk65449199@gmail.com'
  ) THEN
    RETURN 250;
  END IF;
  
  -- Check @aroless.com domain - only first 2 are admin (returns 250 each)
  IF normalized_email LIKE '%@aroless.com' THEN
    SELECT COUNT(*) INTO aroless_count
    FROM public.profiles p
    WHERE lower(btrim(coalesce(p.email, ''))) LIKE '%@aroless.com'
      AND p.created_at <= (
        SELECT created_at FROM public.profiles
        WHERE lower(btrim(coalesce(email, ''))) = normalized_email
      );
    
    IF aroless_count <= 2 THEN
      RETURN 250;
    END IF;
  END IF;
  
  -- Non-admin: use default signup credits (50)
  RETURN 50;
END;
$$;

-- Update existing admin profiles to have 250 credits
UPDATE public.profiles 
SET credits = 250, admin_credits_granted = true
WHERE (
  lower(btrim(coalesce(email, ''))) IN (
    'mryetenek@gmail.com',
    'mk654491931@gmail.com',
    'omnic.111111@gmail.com',
    'mk65449199@gmail.com'
  )
  OR (
    lower(btrim(coalesce(email, ''))) LIKE '%@aroless.com'
    AND created_at <= (
      SELECT MAX(created_at) FROM public.profiles p2 
      WHERE lower(btrim(coalesce(p2.email, ''))) LIKE '%@aroless.com'
      LIMIT 2
    )
  )
)
AND admin_credits_granted = false;

-- Add index for admin lookup performance
CREATE INDEX IF NOT EXISTS idx_admin_credits_granted ON public.profiles(admin_credits_granted);
