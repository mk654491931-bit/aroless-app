-- Lock client-side profile credit columns after refund paths are routed through
-- refund_engine_credits().

REVOKE UPDATE (credits, sim_credits) ON public.profiles FROM authenticated;

COMMENT ON COLUMN public.profiles.credits IS
  'Search credits. Not directly writable by authenticated users -- use refund_engine_credits() or a service_role path.';
COMMENT ON COLUMN public.profiles.sim_credits IS
  'Simulation credits. Not directly writable by authenticated users -- use refund_engine_credits() or a service_role path.';
