import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, noContent, HttpError } from "@/lib/http";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { z } from "zod";

type Ctx = { params: Promise<{ tenantId: string; contactId: string }> };

const UpdateContactSchema = z.object({
  full_name: z.string().min(1).max(255).optional().nullable(),
  phone_number: z.string().min(1).max(50).optional().nullable(),
  email: z.string().email().max(255).optional().nullable(),
  opt_out: z.boolean().optional(),
});

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, contactId } = await params;
    await requireTenantAccess(tenantId);

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("contacts")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", contactId)
      .maybeSingle();

    if (error) return handleError(error);
    if (!data) return handleError(new HttpError(404, "Contact not found"));

    return ok({ contact: data });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { tenantId, contactId } = await params;
    await requireTenantAccess(tenantId);

    const body = await request.json();
    const parsed = UpdateContactSchema.safeParse(body);
    if (!parsed.success) {
      return handleError(new HttpError(400, "Invalid contact data"));
    }

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("contacts")
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", contactId)
      .select()
      .single();

    if (error) return handleError(error);
    return ok({ contact: data });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, contactId } = await params;
    await requireTenantAccess(tenantId);

    const admin = supabaseAdmin();
    const { error } = await admin.from("contacts").delete().eq("tenant_id", tenantId).eq("id", contactId);

    if (error) return handleError(error);
    return noContent();
  } catch (e) {
    return handleError(e);
  }
}