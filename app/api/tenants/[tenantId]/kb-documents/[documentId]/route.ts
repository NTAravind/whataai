import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, HttpError, noContent, ok } from "@/lib/http";
import { deleteDocument, getDocument } from "@/lib/services/kb";

type Ctx = { params: Promise<{ tenantId: string; documentId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, documentId } = await params;
    await requireTenantAccess(tenantId);
    const document = await getDocument(documentId);
    if (document.tenant_id !== tenantId) throw new HttpError(404, "Knowledge document not found");
    return ok({ document });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, documentId } = await params;
    await requireTenantAccess(tenantId);
    await deleteDocument(tenantId, documentId);
    return noContent();
  } catch (e) {
    return handleError(e);
  }
}
