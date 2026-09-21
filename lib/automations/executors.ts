import type { AutomationStep } from "@/lib/automations/types";
import { HttpError } from "@/lib/http";
import { sendWhatsAppText, sendWhatsAppTemplate, sendWhatsAppDocument } from "@/lib/services/wa-send";
import { getIntegrationWithCredentials } from "@/lib/services/integrations";
import { isOAuthProviderType } from "@/lib/integrations/oauth-providers";
import { getValidAccessToken } from "@/lib/integrations/token-refresh";
import { uploadMedia } from "@/lib/meta/whatsapp";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { resolveTarget } from "@/lib/automations/url-guard";

/** Response size caps — stream and abort past the cap. */
const TEXT_LIMIT = 5 * 1024 * 1024;
const BINARY_LIMIT = 15 * 1024 * 1024;

/**
 * Step executors (lib/automations/executors.ts).
 *
 * One function per step type, dictionary lookup — mirrors the `tools`
 * registry in lib/agents/registry.ts. Executors never touch Meta or Postgres
 * credentials directly; sends go through lib/services/wa-send.ts.
 *
 * Logging rule: response bodies are returned as step output; request headers
 * and decrypted credentials (OAuth bearer OR interpolated
 * `{{integration.credential}}`) must never appear in step_results.
 */

export interface ExecContext {
  tenantId: string;
  automationId: string;
  conversationId?: string | null;
  contact?: {
    id: string;
    full_name: string | null;
    phone_number: string | null;
  } | null;
  waAccount?: {
    id: string;
    tenant_id: string;
    wa_phone_number_id: string | null;
    access_token?: string | null;
  } | null;
  /** Top-level variables for this run (captured fields + step_N outputs). */
  variables: Record<string, unknown>;
  /** Maps to a durable step.sleep() in the automation-run function. */
  sleep: (ms: number) => Promise<unknown>;
}

export type Executor = (step: AutomationStep, ctx: ExecContext) => Promise<unknown>;

/**
 * Replace `{{a.b.c}}` by walking the variables object. Values that aren't
 * strings are JSON-stringified. No templating library — the grammar is just
 * dot paths inside double braces. `esc` transforms each substituted value so
 * callers can pick context-appropriate escaping (encodes a URL value, strips
 * header CRLF, JSON-escapes a body string, …).
 */
export function recursiveInterpolate(
  template: string,
  variables: Record<string, unknown>,
  esc: (s: string) => string = (s) => s,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const key = path.trim();
    const value = lookupPath(variables, key);
    if (value === undefined) return _match;
    if (typeof value === "string") return esc(value);
    return esc(JSON.stringify(value));
  });
}

function lookupPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function requireContact(ctx: ExecContext) {
  if (!ctx.contact?.phone_number) {
    throw new HttpError(400, "no contact phone on this run — cannot send a message");
  }
  return ctx.contact;
}

function requireWaAccount(ctx: ExecContext) {
  if (!ctx.waAccount) {
    throw new HttpError(400, "no WhatsApp account configured for this tenant");
  }
  return ctx.waAccount;
}

// ---------------------------------------------------------------------------
// api_call
// ---------------------------------------------------------------------------

async function apiCallExecutor(step: Extract<AutomationStep, { type: "api_call" }>, ctx: ExecContext): Promise<unknown> {
  let integration: Awaited<ReturnType<typeof getIntegrationWithCredentials>> | null = null;
  if (step.integrationId) {
    integration = await getIntegrationWithCredentials(ctx.tenantId, step.integrationId);
  }

  const baseUrl = integration?.base_url?.trim() || null;
  if (!step.url?.trim() && !baseUrl) throw new HttpError(400, "api_call step needs a url or an integration with a base_url");

  const isOauth = integration ? isOAuthProviderType(integration.type) : false;

  // Build a variable set that includes the decrypted credential ONLY for
  // non-OAuth integrations, exposed as integration.credential for the tenant
  // to place themselves (Authorization: Bearer {{integration.credential}}, …).
  const interpolateVars = { ...ctx.variables };
  if (integration && !isOauth) {
    const cred = integration.credentials.apiKey;
    if (cred) interpolateVars.integration = { credential: cred };
  }

  // Guard and resolve the target. `step.url` resolves against the integration
  // base_url (SSRF-safe origin pinning) or must itself be an absolute URL.
  const rawUrl = step.url ? recursiveInterpolate(step.url, interpolateVars, encodeURIComponent) : "/";
  const target = await resolveTarget(rawUrl, baseUrl);

  // JSON body — every interpolated value is JSON-escaped, then parsed by the
  // server, so a value containing `"` or newlines cannot break the payload.
  const bodyText = step.body
    ? recursiveInterpolate(step.body, interpolateVars, (s) => JSON.stringify(s).slice(1, -1))
    : undefined;

  // Headers — interpolated values strip CR/LF so a variable can never smuggle
  // a second header line.
  const stripCrlf = (s: string) => s.replace(/[\r\n]/g, "");
  const headers: Record<string, string> = {};
  if (step.headers) {
    for (const [k, v] of Object.entries(step.headers)) {
      headers[k] = recursiveInterpolate(v, interpolateVars, stripCrlf);
    }
  }

  // OAuth integrations: auto-inject the access token (refreshing first if
  // expired). Tenants never type this header.
  if (isOauth && integration) {
    const token = await getValidAccessToken(ctx.tenantId, integration.id);
    headers.Authorization = `Bearer ${token}`;
  }

  if (bodyText && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }

  // Resolve the WhatsApp account BEFORE the network call when the response is
  // binary: a missing account is a config error, so fail fast without an
  // expensive external request.
  const isBinary = step.responseType === "binary";
  let wa: ReturnType<typeof requireWaAccount> | null = null;
  if (isBinary) wa = requireWaAccount(ctx);

  let res: Response;
  try {
    res = await fetch(target.href, {
      method: step.method,
      headers,
      body: bodyText,
      redirect: "manual", // a 3xx is an error, never silently followed
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new HttpError(502, `api_call failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (isBinary) {
    if (!wa) throw new HttpError(400, "no WhatsApp account configured for this tenant");
    const { bytes, exceeded } = await readCapped(res.body, BINARY_LIMIT);
    if (exceeded) throw new HttpError(502, "api_call binary response exceeded 15 MB");
    const bodySlice = new TextDecoder().decode(bytes.slice(0, 500));
    if (!res.ok) {
      throw new HttpError(
        502,
        isOauth
          ? `api_call binary failed: ${res.status} ${res.statusText}`
          : `api_call binary failed: ${res.status} ${bodySlice}`,
      );
    }
    const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
    const token = wa.access_token ?? undefined;
    const uploaded = await uploadMedia({
      phoneNumberId: wa.wa_phone_number_id ?? "",
      buffer: bytes,
      mimeType,
      filename: step.filename?.trim() || "document",
      accessToken: token,
    });
    return { mediaId: uploaded.id, mimeType };
  }

  const { bytes, exceeded } = await readCapped(res.body, TEXT_LIMIT);
  if (exceeded) throw new HttpError(502, "api_call response exceeded 5 MB");
  const raw = new TextDecoder().decode(bytes);
  if (!res.ok) {
    throw new HttpError(
      502,
      isOauth
        ? `api_call failed: ${res.status} ${res.statusText}`
        : `api_call failed: ${res.status} ${raw.slice(0, 500)}`,
    );
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Read a response body up to `limit` bytes, aborting the stream on overflow. */
async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<{ bytes: Uint8Array; exceeded: boolean }> {
  if (!body) return { bytes: new Uint8Array(0), exceeded: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return { bytes: new Uint8Array(0), exceeded: true };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { bytes: merged, exceeded: false };
}

// ---------------------------------------------------------------------------
// send_message / send_template / send_document
// ---------------------------------------------------------------------------

async function sendMessageExecutor(step: Extract<AutomationStep, { type: "send_message" }>, ctx: ExecContext) {
  const contact = requireContact(ctx);
  const text = recursiveInterpolate(step.text, ctx.variables);
  const result = await sendWhatsAppText({
    tenantId: ctx.tenantId,
    waAccountId: ctx.waAccount?.id,
    to: contact.phone_number!,
    text,
    conversationId: ctx.conversationId ?? undefined,
  });
  return { messageId: result.messageId, status: "queued" };
}

async function sendTemplateExecutor(step: Extract<AutomationStep, { type: "send_template" }>, ctx: ExecContext) {
  const contact = requireContact(ctx);
  const result = await sendWhatsAppTemplate({
    tenantId: ctx.tenantId,
    waAccountId: ctx.waAccount?.id,
    to: contact.phone_number!,
    templateId: step.templateId,
    conversationId: ctx.conversationId ?? undefined,
  });
  return { messageId: result.messageId, status: "queued" };
}

async function sendDocumentExecutor(step: Extract<AutomationStep, { type: "send_document" }>, ctx: ExecContext) {
  const contact = requireContact(ctx);
  const wa = requireWaAccount(ctx);
  const mediaId = step.mediaId ? recursiveInterpolate(step.mediaId, ctx.variables) : undefined;
  const link = step.url ? recursiveInterpolate(step.url, ctx.variables) : undefined;
  const filename = step.filename?.trim() || link?.split("/").pop()?.slice(0, 60) || undefined;
  const result = await sendWhatsAppDocument({
    waAccountId: wa.id,
    to: contact.phone_number!,
    document: { mediaId, link, filename },
    conversationId: ctx.conversationId ?? undefined,
  });
  return { messageId: result.messageId, status: "queued" };
}

// ---------------------------------------------------------------------------
// tag_contact / wait
// ---------------------------------------------------------------------------

async function tagContactExecutor(step: Extract<AutomationStep, { type: "tag_contact" }>, ctx: ExecContext) {
  if (!ctx.contact) throw new HttpError(400, "no contact on this run — cannot tag");
  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("contacts")
    .select("metadata")
    .eq("id", ctx.contact.id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  const metadata = ((row?.metadata ?? {}) as { tags?: string[] }) ?? {};
  const tags = Array.isArray(metadata.tags) ? [...metadata.tags] : [];
  if (!tags.includes(step.tag)) tags.push(step.tag);
  const { error } = await admin
    .from("contacts")
    .update({ metadata: { ...metadata, tags } })
    .eq("id", ctx.contact.id)
    .eq("tenant_id", ctx.tenantId);
  if (error) throw error;
  return { tag: step.tag, tags };
}

async function waitExecutor(step: Extract<AutomationStep, { type: "wait" }>, ctx: ExecContext) {
  await ctx.sleep(step.seconds * 1000);
  return { sleptSeconds: step.seconds };
}

// ---------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------

export const executors: Record<AutomationStep["type"], Executor> = {
  api_call: apiCallExecutor as Executor,
  send_message: sendMessageExecutor as Executor,
  send_template: sendTemplateExecutor as Executor,
  send_document: sendDocumentExecutor as Executor,
  tag_contact: tagContactExecutor as Executor,
  wait: waitExecutor as Executor,
};