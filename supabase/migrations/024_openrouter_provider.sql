-- 024_openrouter_provider.sql
--
-- OpenRouter joins Google and Groq as a live catalog source
-- (lib/openrouter-models.ts + lib/agents/provider.ts). The registry's provider
-- check constraint still only allowed the original two, so syncing OpenRouter
-- models would fail on insert — widen it to the third provider.
--
-- Rows arriving from OpenRouter follow the usual rule: enabled = false until a
-- god user switches them on in /admin/models.

ALTER TABLE public.models DROP CONSTRAINT IF EXISTS models_provider_check;
ALTER TABLE public.models
  ADD CONSTRAINT models_provider_check CHECK (provider IN ('google', 'groq', 'openrouter'));
