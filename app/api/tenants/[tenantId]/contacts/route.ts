import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, created, HttpError } from "@/lib/http";
import { listContacts, getOrCreateContact, type Contact } from "@/lib/services/contacts";
import { z } from "zod";

type Ctx = { params: Promise<{ tenantId: string }> };

const CreateContactSchema = z.object({
  full_name: z.string().min(1).max(255).optional().nullable(),
  phone_number: z.string().min(1).max(50).optional().nullable(),
  email: z.string().email().max(255).optional().nullable(),
});

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);

    const contacts = await listContacts(tenantId);
    return ok({ contacts });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);

    const body = await request.json();
    const parsed = CreateContactSchema.safeParse(body);
    if (!parsed.success) {
      return handleError(new HttpError(400, "Invalid contact data"));
    }

    const { full_name, phone_number, email } = parsed.data;

    if (!phone_number && !email) {
      return handleError(new HttpError(400, "Either phone_number or email is required"));
    }

    // If phone_number provided, use getOrCreateContact for idempotency
    if (phone_number) {
      const contact = await getOrCreateContact(tenantId, phone_number, full_name ?? null);
      if (email) {
        // Update email if provided and different
        const admin = await import("@/lib/clients/supabase").then((m) => m.supabaseAdmin());
        await admin.from("contacts").update({ email }).eq("id", contact.id).eq("tenant_id", tenantId);
        contact.email = email;
      }
      return created({ contact });
    }

    // No phone number - just insert with email
    const admin = await import("@/lib/clients/supabase").then((m) => m.supabaseAdmin());
    const { data, error } = await admin
      .from("contacts")
      .insert({ tenant_id: tenantId, full_name: full_name ?? null, phone_number: null, email: email ?? null })
      .select()
      .single();

    if (error) return handleError(error);
    return created({ contact: data as Contact });
  } catch (e) {
    return handleError(e);
  }
}