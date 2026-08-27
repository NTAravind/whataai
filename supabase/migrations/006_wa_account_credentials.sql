-- Per-account WhatsApp Cloud API credentials.
-- Stored per wa_account so each tenant can bring their own Meta token
-- instead of sharing the global WHATSAPP_API_KEY / WHATSAPP_VERIFY_TOKEN.

ALTER TABLE public.wa_accounts
  ADD COLUMN IF NOT EXISTS access_token text,
  ADD COLUMN IF NOT EXISTS verify_token text;
