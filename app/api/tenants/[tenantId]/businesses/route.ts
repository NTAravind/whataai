import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, created, HttpError } from "@/lib/http";
import { createBusiness, listBusinesses } from "@/lib/services/businesses";
import { supabaseAdmin } from "@/lib/clients/supabase";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ businesses: await listBusinesses(tenantId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);

    // Enforce per-tenant business limit set by god-mode admin
    const { data: tenant } = await supabaseAdmin()
      .from("tenants")
      .select("max_businesses")
      .eq("id", tenantId)
      .maybeSingle();
    const limit = (tenant as { max_businesses: number | null } | null)?.max_businesses ?? null;
    if (limit !== null) {
      const { count } = await supabaseAdmin()
        .from("businesses")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      if ((count ?? 0) >= limit) {
        return handleError(new HttpError(403, `Business limit reached (max ${limit}). Contact support to upgrade.`));
      }

    }

    const body = (await request.json()) as {
      name?: string;
      industry?: string | null;
      timezone?: string;
      metadata?: Record<string, unknown>;
    };
    if (!body.name?.trim()) return handleError(new Error("name is required"));
    return created({
      business: await createBusiness({
        tenant_id: tenantId,
        name: body.name.trim(),
        industry: body.industry,
        timezone: body.timezone,
        metadata: body.metadata,
      }),
    });
  } catch (e) {
    return handleError(e);
  }
}

