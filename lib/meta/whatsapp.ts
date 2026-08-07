import { z } from "zod";

/**
 * Thin, typed client for the Meta WhatsApp Cloud API
 * (see docs/api-guide.md for the raw curl shapes this mirrors).
 *
 * Base URL is versioned — bump `API_VERSION` deliberately (Meta sunsets
 * versions ~2y after release).
 */
const API_VERSION = "v26.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

class MetaApiError extends Error {
  constructor(
    public status: number,
    public code: number | undefined,
    message: string,
    public raw: unknown,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

async function metaFetch(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WHATSAPP_API_KEY}`,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  const text = await res.text();
  const json = text ? safeJson(text) : null;

  if (!res.ok) {
    const err = (json as { error?: { code?: number; message?: string } } | null)?.error;
    throw new MetaApiError(
      res.status,
      err?.code,
      err?.message ?? `Meta API ${res.status}: ${text}`,
      json,
    );
  }
  return json;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Messaging (POST /{PHONE_NUMBER_ID}/messages)
// ---------------------------------------------------------------------------

export interface SendTextInput {
  phoneNumberId: string;
  to: string;
  text: string;
  previewUrl?: boolean;
}

export interface SendTemplateInput {
  phoneNumberId: string;
  to: string;
  templateName: string;
  language: string;
  /** Header/Body/Button component values — see docs/api-guide.md. */
  components?: Record<string, unknown>[];
}

/** Returns the WhatsApp message id (wamid…) assigned by Meta. */
export async function sendTextMessage({ phoneNumberId, to, text, previewUrl = false }: SendTextInput) {
  const json = await metaFetch(`/${phoneNumberId}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: previewUrl, body: text },
    },
  });
  return json as { messaging_product: string; contacts: unknown[]; messages: { id: string }[] };
}

export async function sendTemplateMessage({
  phoneNumberId,
  to,
  templateName,
  language,
  components,
}: SendTemplateInput) {
  const json = await metaFetch(`/${phoneNumberId}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        ...(components?.length ? { components } : {}),
      },
    },
  });
  return json as { messaging_product: string; contacts: unknown[]; messages: { id: string }[] };
}

// ---------------------------------------------------------------------------
// Message templates (GET/POST/DELETE /{WABA_ID}/message_templates)
// ---------------------------------------------------------------------------

export const waTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  category: z.string(),
  sub_category: z.string().optional(),
  language: z.string(),
  parameter_format: z.string().optional(),
  message_send_ttl_seconds: z.number().optional(),
  quality_score: z.object({ score: z.string(), date: z.number() }).optional(),
  source: z.string().optional(),
  components: z.array(z.record(z.string(), z.unknown())).optional(),
});

export type WaTemplate = z.infer<typeof waTemplateSchema>;

export async function listTemplates(wabaId: string, afterCursor?: string) {
  const cursor = afterCursor ? `&after=${encodeURIComponent(afterCursor)}` : "";
  const json = await metaFetch(`/${wabaId}/message_templates?limit=100${cursor}`);
  return json as {
    data?: WaTemplate[];
    paging?: { cursors?: { after?: string }; next?: string };
  };
}

export interface CreateTemplateInput {
  wabaId: string;
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  components: Record<string, unknown>[];
  subCategory?: string;
  messageSendTtlSeconds?: number;
}

export async function createTemplate({
  wabaId,
  name,
  language,
  category,
  components,
  subCategory,
  messageSendTtlSeconds,
}: CreateTemplateInput) {
  const json = await metaFetch(`/${wabaId}/message_templates`, {
    method: "POST",
    body: {
      name,
      language,
      category,
      ...(subCategory ? { sub_category: subCategory } : {}),
      ...(messageSendTtlSeconds ? { message_send_ttl_seconds: messageSendTtlSeconds } : {}),
      components,
    },
  });
  return json as { id: string; status: string; category: string };
}

export async function deleteTemplate(wabaId: string, name: string) {
  await metaFetch(`/${wabaId}/message_templates?name=${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  return true;
}

// ---------------------------------------------------------------------------
// Campaign schedules (GET/POST /{WABA_ID}/schedules)
// ---------------------------------------------------------------------------

export async function listSchedules(wabaId: string) {
  const json = await metaFetch(`/${wabaId}/schedules`);
  return json as {
    data?: { id: string; name: string; description?: string; delivery_time: number; status: string }[];
    paging?: { cursors?: { after?: string } };
  };
}

export interface CreateScheduleInput {
  wabaId: string;
  templateName: string; // hsm_id equivalent — Meta uses the template id
  audienceId: string;
  wabaCsId?: string;
  name: string;
  description?: string;
  deliveryTime: number; // unix seconds
}

export async function createSchedule({
  wabaId,
  templateName,
  audienceId,
  wabaCsId,
  name,
  description,
  deliveryTime,
}: CreateScheduleInput) {
  const json = await metaFetch(`/${wabaId}/schedules`, {
    method: "POST",
    body: {
      hsm_id: templateName,
      audience_id: audienceId,
      ...(wabaCsId ? { waba_cs_id: wabaCsId } : {}),
      name,
      ...(description ? { description } : {}),
      delivery_time: deliveryTime,
    },
  });
  return json as { id: string };
}

// ---------------------------------------------------------------------------
// WABA management (GET/POST /{WABA_ID})
// ---------------------------------------------------------------------------

export async function getWaba(wabaId: string) {
  const json = await metaFetch(`/${wabaId}`);
  return json as Record<string, unknown>;
}

export async function updateWaba(wabaId: string, patch: Record<string, unknown>) {
  const json = await metaFetch(`/${wabaId}`, { method: "POST", body: patch });
  return json;
}

// ---------------------------------------------------------------------------
// Trigger a Flow (POST /{PHONE_NUMBER_ID}/messages with type=flow)
// ---------------------------------------------------------------------------

export interface TriggerFlowInput {
  phoneNumberId: string;
  to: string;
  flowId: string; // Meta flow id (flows.meta_flow_id)
  ctaText: string;
  data?: Record<string, unknown>;
  mode?: "draft" | "published";
}

export async function triggerFlow({ phoneNumberId, to, flowId, ctaText, data, mode = "published" }: TriggerFlowInput) {
  const json = await metaFetch(`/${phoneNumberId}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "flow",
      flow: {
        mode,
        flow_message_type: "flow",
        flow_id: flowId,
        flow_cta: ctaText,
        ...(data ? { flow_token: data } : {}),
      },
    },
  });
  return json as { messaging_product: string; contacts: unknown[]; messages: { id: string }[] };
}

export { MetaApiError };
