-- ============================================================================
-- 019. Outbound message dedupe
--
-- message/outbound.send is at-least-once: a retried Inngest delivery must not
-- create a second messages row, so each outbound message claims a caller-supplied
-- dedupe key and the insert is unique per (dedupe_key).
-- ============================================================================

ALTER TABLE public.messages ADD COLUMN dedupe_key text;

CREATE UNIQUE INDEX messages_dedupe_key_idx
  ON public.messages (dedupe_key)
  WHERE dedupe_key IS NOT NULL;