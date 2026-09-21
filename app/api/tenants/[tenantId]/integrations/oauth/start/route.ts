import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";
import { HttpError } from "@/lib/http";
import { supabaseAdmin } from "@/lib/clients/supabase";
import crypto from "node:crypto";
import { OAUTH_PROVIDERS, type OAuthProviderType } from "@/lib/integrations/oauth-providers";

type Ctx = { params: Promise<{ tenantId: string }> };

/**
 * Begin an OAuth2 authorization-code handshake: mint a random state, persist it
 * (oauth_states), and return the provider authorize URL. The client navigates
 * there; the provider calls back into /api/auth/oauth/callback.
 */
export async function GET(request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);

    const url = new URL(request.url);
    const provider = url.searchParams.get("provider") ?? "";
    const integrationName = url.searchParams.get("integrationName")?.trim() || provider;

    const providerConfig = OAUTH_PROVIDERS[provider as OAuthProviderType];
    if (!providerConfig) {
      throw new HttpError(400, `unknown oauth provider: ${provider}`);
    }

    const clientId = process.env[providerConfig.clientIdEnv];
    const clientSecret = process.env[providerConfig.clientSecretEnv];
    if (!clientId || !clientSecret) {
      throw new HttpError(
        500,
        `${providerConfig.clientIdEnv}/${providerConfig.clientSecretEnv} are not configured`,
      );
    }

    const state = crypto.randomUUID();
    const { error } = await supabaseAdmin().from("oauth_states").insert({
      state,
      tenant_id: tenantId,
      provider_type: provider,
      integration_name: integrationName,
    });
    if (error) throw new HttpError(500, error.message);

    const redirectUri = `${url.origin}/api/auth/oauth/callback`;
    const authParams = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: providerConfig.scopes.join(" "),
      state,
      ...providerConfig.extraAuthParams,
    });

    return ok({ authorizeUrl: `${providerConfig.authorizeUrl}?${authParams}` });
  } catch (e) {
    return handleError(e);
  }
}