import type { AutomationStep } from "@/lib/automations/types";
import { HttpError } from "@/lib/http";
import { sendWhatsAppText, sendWhatsAppTemplate, sendWhatsAppDocument } from "@/lib/services/wa-send";
import { getIntegrationWithCredentials } from "@/lib/services/integrations";
import { isOAuthProviderType } from "@/lib/integrations/oauth-providers";
import { getValidAccessToken } from "@/lib/integrations/token-refresh";
import { getTemplate } from "@/lib/services/templates";
import { uploadMedia } from "@/lib/meta/whatsapp";
import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { resolveTarget } from "@/lib/automations/url-guard";
import { NonRetriableError } from "inngest";

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
  } | null;
  /** Top-level variables for this run (captured fields + step_N outputs). */
  variables: Record<string, unknown>;
  /** Run + step identity, for dedupe keys / Idempotency headers. */
  runId?: string;
  stepIndex?: number;
  /** Maps to a durable step.sleep() in the automation-run function. */
  sleep: (ms: number) => Promise<unknown>;
}

export type Executor = (step: AutomationStep, ctx: ExecContext) => Promise<unknown>;

/**
 * Strict interpolation — throws NonRetriableError listing missing variables.
 * Returns interpolated string on success.
 */
function recursiveInterpolateStrict(
  template: string,
  variables: Record<string, unknown>,
  esc: (s: string) => string = (s) => s,
): string {
  const missing: string[] = [];
  const result = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const key = path.trim();
    const value = lookupPath(variables, key);
    if (value === undefined) {
      missing.push(key);
      return _match; // keep placeholder for error message
    }
    if (typeof value === "string") return esc(value);
    return esc(JSON.stringify(value));
  });
  if (missing.length > 0) {
    throw new NonRetriableError(`missing variables for strict interpolation: ${missing.join(", ")}`);
  }
  return result;
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

/**
 * Replace `{{a.b.c}}` by walking the variables object. Values that aren't
 * strings are JSON-stringified. No templating library — the grammar is just
 * dot paths inside double braces. `esc` transforms each substituted value so
 * callers can pick context-appropriate escaping (encodes a URL value, strips
 * header CRLF, JSON-escapes a body string, …).
 * Non-strict version: unresolved variables are left as-is in the template.
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

/** Fresh WhatsApp token from the DB — never captured into the run's context. */
async function resolveWaAccessToken(tenantId: string, waAccountId: string): Promise<string | undefined> {
  const { data, error } = await supabaseAdmin()
    .from("wa_accounts")
    .select("access_token")
    .eq("id", waAccountId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw error;
  return (data as { access_token: string | null } | null)?.access_token ?? undefined;
}

/** Stable dedupe key for a step's outbound message, when we know which step it is. */
function stepDedupeKey(ctx: ExecContext): string | undefined {
  if (ctx.runId === undefined || ctx.stepIndex === undefined) return undefined;
  return `${ctx.runId}:${ctx.stepIndex}`;
}

// ---------------------------------------------------------------------------
// api_call
// ---------------------------------------------------------------------------

async function apiCallExecutor(step: AutomationStep, ctx: ExecContext): Promise<unknown> {
  if (step.type !== "api_call") throw new Error("wrong executor");
  const s = step;
  let integration: Awaited<ReturnType<typeof getIntegrationWithCredentials>> | null = null;
  if (s.integrationId) {
    integration = await getIntegrationWithCredentials(ctx.tenantId, s.integrationId);
  }

const baseUrl = integration?.base_url?.trim() || null;
  if (!s.url?.trim() && !baseUrl) throw new HttpError(400, "api_call step needs a url or an integration with a base_url");

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
  const rawUrl = s.url ? recursiveInterpolate(s.url, interpolateVars, encodeURIComponent) : "/";
  const target = await resolveTarget(rawUrl, baseUrl);

  // JSON body — every interpolated value is JSON-escaped, then parsed by the
  // server, so a value containing `"` or newlines cannot break the payload.
  const bodyText = s.body
    ? recursiveInterpolate(s.body, interpolateVars, (s_) => JSON.stringify(s_).slice(1, -1))
    : undefined;

  // Headers — interpolated values strip CR/LF so a variable can never smuggle
  // a second header line.
  const stripCrlf = (s_: string) => s_.replace(/[\r\n]/g, "");
  const headers: Record<string, string> = {};
  if (s.headers) {
    for (const [k, v] of Object.entries(s.headers)) {
      headers[k] = recursiveInterpolate(v, interpolateVars, stripCrlf);
    }
  }

  // Safe-to-retry steps advertise an idempotency key so a retried fetch after a
  // timeout cannot double-submit (GET is idempotent by definition). Callers may
  // pin their own header to a stateful key (e.g. `${ctx.runId}:${ctx.stepIndex}`).
  if (s.method !== "GET" && !headers["Idempotency-Key"] && ctx.runId !== undefined && ctx.stepIndex !== undefined) {
    headers["Idempotency-Key"] = `automation:${ctx.runId}:${ctx.stepIndex}`;
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
  const isBinary = s.responseType === "binary";
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
    // The WhatsApp token lives in the DB, resolved here (fresh per attempt)
    // rather than captured into the run's checkpointed context.
    const token = await resolveWaAccessToken(ctx.tenantId, wa.id);
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

/** Truncate a JSON-serializable value to ~20 KB for step_results storage. */
export function truncateOutput(value: unknown): unknown {
  const json = JSON.stringify(value);
  const MAX = 20 * 1024; // 20 KB
  if (json.length <= MAX) return value;
  const preview = json.slice(0, 2 * 1024); // 2 KB preview
  return { truncated: true, bytes: json.length, preview: JSON.parse(preview) };
}

// ---------------------------------------------------------------------------
// send_message / send_template / send_document
// ---------------------------------------------------------------------------

async function sendMessageExecutor(step: AutomationStep, ctx: ExecContext) {
  if (step.type !== "send_message") throw new Error("wrong executor");
  const s = step;
  const contact = requireContact(ctx);
  const strict = s.strict ?? true;
  const text = strict
    ? recursiveInterpolateStrict(s.text, ctx.variables)
    : recursiveInterpolate(s.text, ctx.variables);
  const result = await sendWhatsAppText({
    tenantId: ctx.tenantId,
    waAccountId: ctx.waAccount?.id,
    to: contact.phone_number!,
    text,
    conversationId: ctx.conversationId ?? undefined,
    dedupeKey: stepDedupeKey(ctx),
  });
  return { messageId: result.messageId, status: "queued" };
}

async function sendTemplateExecutor(step: AutomationStep, ctx: ExecContext) {
  if (step.type !== "send_template") throw new Error("wrong executor");
  const s = step;
  const contact = requireContact(ctx);
  const strict = s.strict ?? true;

  // Load template to count body placeholders ({{1}}, {{2}}...).
  const template = await getTemplate(s.templateId, ctx.tenantId);
  if (!template) throw new HttpError(404, "Template not found");

  // Extract body text from components to count placeholders.
  const bodyComponents = (template.components as Array<{ type: string; text?: string }> | undefined)?.filter(
    (c) => c.type === "BODY" && c.text,
  ) ?? [];
  const bodyText = bodyComponents.map((c) => c.text).join("");
  const placeholderCount = (bodyText.match(/\{\{\s*\d+\s*\}\}/g) ?? []).length;

  // Interpolate each param from ctx.variables.
  const rawParams = s.params ?? [];
  const params: string[] = [];
  for (const p of rawParams) {
    const interpolated = strict
      ? recursiveInterpolateStrict(p, ctx.variables)
      : recursiveInterpolate(p, ctx.variables);
    params.push(interpolated);
  }

  if (placeholderCount > 0 && params.length !== placeholderCount) {
    throw new NonRetriableError(
      `template "${template.name}" has ${placeholderCount} body placeholder(s) but ${params.length} param(s) provided`,
    );
  }

  const result = await sendWhatsAppTemplate({
    tenantId: ctx.tenantId,
    waAccountId: ctx.waAccount?.id,
    to: contact.phone_number!,
    templateId: s.templateId,
    params,
    conversationId: ctx.conversationId ?? undefined,
    dedupeKey: stepDedupeKey(ctx),
  });
  return { messageId: result.messageId, status: "queued" };
}

async function sendDocumentExecutor(step: AutomationStep, ctx: ExecContext) {
  if (step.type !== "send_document") throw new Error("wrong executor");
  const s = step;
  const contact = requireContact(ctx);
  const wa = requireWaAccount(ctx);
  const strict = s.strict ?? true;
  const mediaId = s.mediaId
    ? (strict
        ? recursiveInterpolateStrict(s.mediaId, ctx.variables)
        : recursiveInterpolate(s.mediaId, ctx.variables))
    : undefined;
  const link = s.url
    ? (strict
        ? recursiveInterpolateStrict(s.url, ctx.variables)
        : recursiveInterpolate(s.url, ctx.variables))
    : undefined;
  const filename = s.filename?.trim() || link?.split("/").pop()?.slice(0, 60) || undefined;
  const result = await sendWhatsAppDocument({
    waAccountId: wa.id,
    to: contact.phone_number!,
    document: { mediaId, link, filename },
    conversationId: ctx.conversationId ?? undefined,
    dedupeKey: stepDedupeKey(ctx),
  });
  return { messageId: result.messageId, status: "queued" };
}

// ---------------------------------------------------------------------------
// tag_contact / wait
// ---------------------------------------------------------------------------

async function tagContactExecutor(step: AutomationStep, ctx: ExecContext) {
  if (step.type !== "tag_contact") throw new Error("wrong executor");
  const s = step;
  if (!ctx.contact) throw new HttpError(400, "no contact on this run — cannot tag");
  // Atomic append-if-absent via the DB function — never read-modify-write the
  // whole metadata column from here (concurrent steps would lose tags).
  const tags = unwrap(
    await supabaseAdmin().rpc("add_contact_tag", {
      p_tenant: ctx.tenantId,
      p_contact: ctx.contact.id,
      p_tag: s.tag,
    }),
  );
  return { tag: s.tag, tags };
}

async function waitExecutor(step: AutomationStep, ctx: ExecContext) {
  if (step.type !== "wait") throw new Error("wrong executor");
  const s = step;
  await ctx.sleep(s.seconds * 1000);
  return { sleptSeconds: s.seconds };
}

// ---------------------------------------------------------------------------
// Dictionary — Record<...> allows index access with union key; exhaustiveness
// is verified by the object literal containing every AutomationStep["type"].
// ---------------------------------------------------------------------------

export const executors: Record<AutomationStep["type"], Executor> = {
  api_call: apiCallExecutor,
  send_message: sendMessageExecutor,
  send_template: sendTemplateExecutor,
  send_document: sendDocumentExecutor,
  tag_contact: tagContactExecutor,
  wait: waitExecutor,
};