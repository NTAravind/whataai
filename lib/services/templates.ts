import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import * as meta from "@/lib/meta/whatsapp";

/**
 * WhatsApp template service — source of truth is `whatsapp_templates`,
 * Meta is the async authority for approval status (PENDING → APPROVED/REJECTED
 * arrives via the message_template_status_update webhook).
 */

export interface TemplateRow {
  id: string;
  tenant_id: string;
  wa_account_id: string;
  name: string;
  category: string;
  sub_category: string | null;
  language: string;
  status: string; // pending | approved | rejected | disabled
  components: Record<string, unknown>[];
  meta_template_id: string | null;
  rejection_reason: string | null;
  quality_score: Record<string, unknown> | null;
}

export interface WaAccountRow {
  id: string;
  tenant_id: string;
  wa_business_account_id: string | null;
  wa_phone_number_id: string | null;
  display_phone_number: string | null;
}

export async function listTemplates(tenantId: string) {
  return unwrap(
    await supabaseAdmin()
      .from("whatsapp_templates")
      .select("*, wa_account:wa_accounts(display_phone_number)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
  );
}

export async function getTemplate(templateId: string, tenantId?: string) {
  let query = supabaseAdmin().from("whatsapp_templates").select("*").eq("id", templateId);
  if (tenantId) query = query.eq("tenant_id", tenantId);
  return unwrap<TemplateRow>(await query.single());
}

export async function getWaAccount(waAccountId: string, tenantId: string) {
  return unwrap<WaAccountRow>(
    await supabaseAdmin()
      .from("wa_accounts")
      .select("*")
      .eq("id", waAccountId)
      .eq("tenant_id", tenantId)
      .single(),
  );
}

/**
 * Find the approved template used for booking reminders: the newest approved
 * template whose name contains "reminder" (e.g. booking_reminder,
 * appointment_reminder). Returns null when none exists so callers fall back.
 */
export async function findReminderTemplate(
  tenantId: string,
  waAccountId: string,
): Promise<TemplateRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("whatsapp_templates")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("wa_account_id", waAccountId)
    .eq("status", "approved")
    .ilike("name", "%reminder%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[templates] findReminderTemplate query failed:", error);
    return null;
  }
  return (data as TemplateRow | null) ?? null;
}

export interface ReminderTemplateData {
  customerName: string;
  serviceName: string;
  dateLabel: string;
}

/**
 * Build an outbound template payload for a reminder. Reads the template's
 * BODY placeholders ({{1}}, {{2}}, …) and fills them positionally:
 * {{1}}=customer name, {{2}}=service name, {{3}}=date/time label.
 * Returns null when the template has no BODY component.
 */
export function buildReminderTemplateContent(
  template: TemplateRow,
  data: ReminderTemplateData,
): { content: { type: "template"; meta: { template_id: string; parameters?: string[] } }; templateId: string } | null {
  const body = (template.components ?? []).find(
    (c) => (c as Record<string, unknown>).type === "BODY",
  ) as (Record<string, unknown> & { text?: string }) | undefined;
  if (!body || typeof body.text !== "string") return null;

  const indices = [...body.text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
  const placeholderCount = indices.length ? Math.max(...indices) : 0;
  if (placeholderCount === 0) {
    return {
      content: { type: "template", meta: { template_id: template.id } },
      templateId: template.id,
    };
  }

  const values = [data.customerName, data.serviceName, data.dateLabel];
  const parameters = Array.from({ length: placeholderCount }, (_, i) => values[i] ?? "");
  return {
    content: { type: "template", meta: { template_id: template.id, parameters } },
    templateId: template.id,
  };
}

export interface CreateTemplateInput {
  tenantId: string;
  waAccountId: string;
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  components: Record<string, unknown>[];
  subCategory?: string;
  messageSendTtlSeconds?: number;
}

/** Persist locally first, then submit to Meta; approval arrives async. */
export async function createTemplate(input: CreateTemplateInput) {
  const admin = supabaseAdmin();
  const wa = await getWaAccount(input.waAccountId, input.tenantId);

  const { data, error } = await admin
    .from("whatsapp_templates")
    .insert({
      tenant_id: input.tenantId,
      wa_account_id: input.waAccountId,
      name: input.name,
      category: input.category,
      sub_category: input.subCategory ?? null,
      language: input.language,
      status: "pending",
      components: input.components,
      parameter_format: "NAMED",
      message_send_ttl_seconds: input.messageSendTtlSeconds ?? null,
      source: "manual",
    })
    .select()
    .single();
  if (error) throw error;

  const wabaId = wa.wa_business_account_id;
  if (!wabaId) {
    await admin
      .from("whatsapp_templates")
      .update({ status: "rejected", rejection_reason: "wa_accounts.wa_business_account_id not set" })
      .eq("id", data.id);
    throw new Error("Cannot create template: wa_accounts.wa_business_account_id not set");
  }

  try {
    const metaRes = await meta.createTemplate({
      wabaId,
      name: input.name,
      language: input.language,
      category: input.category,
      components: input.components,
      subCategory: input.subCategory,
      messageSendTtlSeconds: input.messageSendTtlSeconds,
    });
    if (!metaRes || typeof metaRes.id !== "string" || !metaRes.id) {
      throw new Error("Meta returned no template id — submission did not complete.");
    }
    await admin
      .from("whatsapp_templates")
      .update({ meta_template_id: metaRes.id })
      .eq("id", data.id);
  } catch (err) {
    await admin
      .from("whatsapp_templates")
      .update({ status: "rejected", rejection_reason: err instanceof Error ? err.message : String(err) })
      .eq("id", data.id);
    throw err;
  }

  return data;
}

export async function deleteTemplate(templateId: string, tenantId: string) {
  const admin = supabaseAdmin();
  const template = await getTemplate(templateId, tenantId);
  const wa = await getWaAccount(template.wa_account_id, tenantId);

  try {
    if (wa.wa_business_account_id) {
      await meta.deleteTemplate(wa.wa_business_account_id, template.name);
    }
  } catch (err) {
    // Meta may already not know about it (e.g. never submitted). Log so a
    // silent failure is visible rather than swallowed outright.
    console.warn(
      `[templates] Meta delete failed for template "${template.name}" (wa_account ${template.wa_account_id}):`,
      err
    );
  }
  await admin.from("whatsapp_templates").delete().eq("id", templateId).eq("tenant_id", tenantId);
  return true;
}

/** Sync approval status into our local row (called from the ingest function). */
export async function applyTemplateStatusUpdate(input: {
  metaTemplateId?: string | null;
  /** Either wa_accounts.wa_phone_number_id or the WABA business account id. */
  waAccountId?: string | null;
  /** The WABA business account id (preferred — template webhooks carry it as entry.id). */
  wabaBusinessAccountId?: string | null;
  name: string;
  status: string;
  rejectionReason?: string | null;
}) {
  const admin = supabaseAdmin();
  let accountId: string | null = null;

  if (input.wabaBusinessAccountId) {
    const { data: wa } = await admin
      .from("wa_accounts")
      .select("id")
      .eq("wa_business_account_id", input.wabaBusinessAccountId)
      .maybeSingle();
    accountId = wa?.id ?? null;
  }
  if (!accountId && input.waAccountId) {
    const { data: wa } = await admin
      .from("wa_accounts")
      .select("id")
      .eq("wa_phone_number_id", input.waAccountId)
      .maybeSingle();
    accountId = wa?.id ?? input.waAccountId;
  }
  if (!accountId) {
    console.warn(
      `[templates] applyTemplateStatusUpdate: no wa_account matched for ${JSON.stringify({
        wabaId: input.wabaBusinessAccountId ?? undefined,
        waAccountId: input.waAccountId ?? undefined,
      })}; template "${input.name}" status update ignored.`,
    );
    return;
  }

  const { data, error } = await admin
    .from("whatsapp_templates")
    .update({
      status: input.status.toLowerCase(),
      rejection_reason: input.rejectionReason ?? null,
      ...(input.metaTemplateId ? { meta_template_id: input.metaTemplateId } : {}),
    })
    .eq("wa_account_id", accountId)
    .ilike("name", input.name)
    .select("id");

  if (error) {
    console.error("[templates] applyTemplateStatusUpdate update failed:", error);
  } else if (!data || data.length === 0) {
    // This is the silent-failure class where a template stays stuck in
    // "pending" because the incoming name didn't exactly match a local row.
    console.warn(
      `[templates] applyTemplateStatusUpdate: no local template matched for wa_account=${accountId} name="${input.name}" status="${input.status}". ` +
        "Template may remain stuck in pending. Check name normalization (case/underscores).",
    );
  }

  return { matched: data ? data.length : 0 };
}

export async function pullTemplatesFromMeta(tenantId: string, waAccountId: string) {
  const admin = supabaseAdmin();
  const wa = await getWaAccount(waAccountId, tenantId);
  if (!wa.wa_business_account_id) return 0;
  let cursor: string | undefined;
  let pulled = 0;

  do {
    const res = await meta.listTemplates(wa.wa_business_account_id, cursor);
    for (const t of res.data ?? []) {
      await admin
        .from("whatsapp_templates")
        .upsert(
          {
            tenant_id: tenantId,
            wa_account_id: waAccountId,
            name: t.name,
            category: t.category,
            sub_category: t.sub_category ?? null,
            language: t.language,
            status: t.status.toLowerCase(),
            components: (t.components ?? []) as Record<string, unknown>[],
            meta_template_id: t.id,
            parameter_format: t.parameter_format ?? "NAMED",
            message_send_ttl_seconds: t.message_send_ttl_seconds ?? null,
            quality_score: (t.quality_score as Record<string, unknown>) ?? null,
            source: t.source ?? "manual",
          },
          { onConflict: "wa_account_id,name,language" },
        );
      pulled++;
    }
    cursor = res.paging?.cursors?.after;
  } while (cursor);

  return pulled;
}
