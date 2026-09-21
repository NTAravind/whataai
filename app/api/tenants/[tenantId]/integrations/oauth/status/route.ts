import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";
import { OAUTH_PROVIDERS } from "@/lib/integrations/oauth-providers";

type Ctx = { params: Promise<{ tenantId: string }> };

/**
 * OAuth availability per provider. `clientId` is only sent when the matching
 * secret env var is set, so the UI can disable connect buttons before the
 * operator has configured the provider handshake.
 */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({
      providers: Object.entries(OAUTH_PROVIDERS).map(([id, config]) => ({
        id,
        scopes: config.scopes,
        clientId: process.env[config.clientIdEnv] ?? null,
        configured: Boolean(
          process.env[config.clientIdEnv] && process.env[config.clientSecretEnv],
        ),
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}