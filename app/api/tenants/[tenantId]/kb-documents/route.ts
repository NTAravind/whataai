import { requireTenantAccess } from "@/lib/auth/guard";
import { created, handleError, HttpError, ok } from "@/lib/http";
import { createDocument, listDocuments } from "@/lib/services/kb";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ documents: await listDocuments(tenantId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as {
      title?: string;
      rawContent?: string;
      sourceType?: string;
    };
    const title = body.title?.trim();
    const rawContent = body.rawContent?.trim();
    if (!title) throw new HttpError(400, "title is required");
    if (!rawContent) throw new HttpError(400, "rawContent is required");

    return created({
      document: await createDocument({
        tenantId,
        title,
        rawContent,
        sourceType: body.sourceType?.trim() || "manual",
      }),
    });
  } catch (e) {
    return handleError(e);
  }
}
