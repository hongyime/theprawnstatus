CREATE TABLE IF NOT EXISTS public.keepalive_logs (
  id bigserial PRIMARY KEY,
  source text,
  pinged_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.keepalive_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_insert" ON public.keepalive_logs;
CREATE POLICY "anon_insert" ON public.keepalive_logs
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "anon_select" ON public.keepalive_logs;
CREATE POLICY "anon_select" ON public.keepalive_logs
  FOR SELECT TO anon USING (true);
