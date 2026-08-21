CREATE TABLE public.free_credit_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  visitor_id text,
  ip_hash text,
  granted boolean NOT NULL,
  credits integer NOT NULL DEFAULT 0,
  sim_credits integer NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT 'signup',
  source text NOT NULL DEFAULT 'unknown',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_free_credit_audit_created_at ON public.free_credit_audit (created_at DESC);
CREATE INDEX idx_free_credit_audit_visitor ON public.free_credit_audit (visitor_id);
CREATE INDEX idx_free_credit_audit_ip ON public.free_credit_audit (ip_hash);

GRANT SELECT ON public.free_credit_audit TO authenticated;
GRANT ALL ON public.free_credit_audit TO service_role;

ALTER TABLE public.free_credit_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view free credit audit"
  ON public.free_credit_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));