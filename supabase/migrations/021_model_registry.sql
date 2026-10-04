-- 021_model_registry.sql
--
-- Admin-managed model registry (god-mode "/admin/models").
--
-- The catalog of *available* models is discovered live from the Google and
-- Groq APIs (lib/agents/provider.ts). This table is the platform's own record
-- of those models and is the single authority for which of them clients may
-- select: a model is only offered once a row exists here with enabled = true.
--
-- `pricing_override_*` are null unless a god user overrode the provider's
-- reported price. Cost calculation prefers the override, then the registry
-- price, then the provider price.
--
-- Per-plan availability is NOT stored here — it lives in
-- plans.limits->>'allowed_models' (see 001_initial-schema.sql + planLimitsSchema).

-- ---------------------------------------------------------------------------
-- models
-- ---------------------------------------------------------------------------
CREATE TABLE public.models (
  id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('google', 'groq')),
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  -- USD per 1M tokens.
  input_per_million numeric NOT NULL DEFAULT 0,
  output_per_million numeric NOT NULL DEFAULT 0,
  pricing_override_input numeric,
  pricing_override_output numeric,
  context_window integer,
  max_completion_tokens integer,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT models_pkey PRIMARY KEY (id)
);

CREATE INDEX models_enabled_idx ON public.models (enabled) WHERE enabled;

-- ---------------------------------------------------------------------------
-- Row Level Security — global catalog, so authenticated users may read it and
-- only god users may write it. Mirrors the `plans` policy pair.
-- ---------------------------------------------------------------------------
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;

CREATE POLICY authenticated_read ON public.models
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY god_manage_all ON public.models
  FOR ALL USING (public.is_god_user()) WITH CHECK (public.is_god_user());

-- ---------------------------------------------------------------------------
-- Seed the catalog that is live as of this migration, enabled, so deploying
-- this does not change what tenants can select. Models the provider APIs later
-- report are inserted by syncModelCatalog() as enabled = false and must be
-- switched on deliberately.
-- ---------------------------------------------------------------------------
INSERT INTO public.models (id, provider, label, enabled, input_per_million, output_per_million) VALUES
  ('gemini-2.5-flash',          'google', 'Gemini 2.5 Flash',          true, 0.30,  2.50),
  ('gemini-2.5-pro',            'google', 'Gemini 2.5 Pro',            true, 1.25,  10.00),
  ('gemini-2.5-flash-lite',     'google', 'Gemini 2.5 Flash-Lite',     true, 0.10,  0.40),
  ('gemini-2.5-flash-lite-preview-06-17', 'google', 'Gemini 2.5 Flash-Lite (preview)', true, 0.10, 0.40),
  ('gemini-2.0-flash',          'google', 'Gemini 2.0 Flash',          true, 0.10,  0.40),
  ('gemini-3.8-flash',          'google', 'Gemini 3.8 Flash',          true, 0.75,  3.75),
  ('gemini-3.6-flash',          'google', 'Gemini 3.6 Flash',          true, 1.50,  7.50),
  ('gemini-3.5-flash',          'google', 'Gemini 3.5 Flash',          true, 1.50,  9.00),
  ('gemini-3.5-flash-lite',     'google', 'Gemini 3.5 Flash-Lite',     true, 0.30,  2.50),
  ('gemini-3.1-pro-preview',    'google', 'Gemini 3.1 Pro (preview)',  true, 2.00,  12.00),
  ('gemini-3.1-flash-lite',     'google', 'Gemini 3.1 Flash-Lite',     true, 0.25,  1.50),
  ('gemini-3.1-flash-lite-preview-06-17', 'google', 'Gemini 3.1 Flash-Lite (preview)', true, 0.25, 1.50),
  ('gemini-3-pro-preview',      'google', 'Gemini 3 Pro (preview)',    true, 2.00,  12.00),
  ('gemini-3-flash-preview',    'google', 'Gemini 3 Flash (preview)',  true, 0.50,  3.00),
  ('openai/gpt-oss-120b',       'groq',   'GPT OSS 120B',              true, 0.15,  0.60),
  ('openai/gpt-oss-20b',        'groq',   'GPT OSS 20B',               true, 0.075, 0.30),
  ('qwen/qwen3.8-27b',          'groq',   'Qwen3.8 27B',               true, 0.80,  4.00)
ON CONFLICT (id) DO NOTHING;