import { getIntegrationWithCredentials, updateIntegrationCredentials } from "@/lib/services/integrations";
import { OAUTH_PROVIDERS, type OAuthProviderType } from "@/lib/integrations/oauth-providers";
import { HttpError } from "@/lib/http";

/**
 * Return a fresh access token for an OAuth-backed integration, refreshing
 * against `provider.tokenUrl` when the stored token is about to expire. One
 * function handles every provider — refresh is always
 * `grant_type=refresh_token` against the provider's tokenUrl.
 */
export async function getValidAccessToken(tenantId: string, integrationId: string): Promise<string> {
  const integration = await getIntegrationWithCredentials(tenantId, integrationId);
  const creds = integration.credentials;

  if (creds.expiresAt && creds.expiresAt > Date.now() + 60_000) {
    if (!creds.accessToken) throw new HttpError(502, "integration has no access token");
    return creds.accessToken;
  }

  const providerConfig = OAUTH_PROVIDERS[integration.type as OAuthProviderType];
  if (!providerConfig) {
    throw new HttpError(400, `integration type ${integration.type} is not an OAuth provider`);
  }
  if (!creds.refreshToken) throw new HttpError(502, "integration has no refresh token");

  const clientId = process.env[providerConfig.clientIdEnv];
  const clientSecret = process.env[providerConfig.clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new HttpError(500, `missing ${providerConfig.clientIdEnv}/${providerConfig.clientSecretEnv} env vars`);
  }

  const res = await fetch(providerConfig.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new HttpError(502, `oauth refresh failed: ${res.status} ${res.statusText}`);

  const tokens = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const nextExpiresAt = typeof tokens.expires_in === "number" ? Date.now() + tokens.expires_in * 1000 : undefined;
  await updateIntegrationCredentials(integrationId, tenantId, {
    ...creds,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? creds.refreshToken,
    ...(nextExpiresAt ? { expiresAt: nextExpiresAt } : {}),
  });

  if (!tokens.access_token) throw new HttpError(502, "oauth refresh returned no access_token");
  return tokens.access_token;
}