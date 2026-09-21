import { NextResponse } from "next/server";
import { HttpError, handleError } from "@/lib/http";
import { supabaseAdmin } from "@/lib/clients/supabase";
import {
  OAUTH_PROVIDERS,
  type OAuthProviderType,
} from "@/lib/integrations/oauth-providers";
import { createIntegration, updateIntegrationCredentials } from "@/lib/services/integrations";

/**
 * OAuth2 redirect target for every provider. Exchanges the code for tokens,
 * saves the encrypted credentials on a fresh integration row, consumes the
 * state row, then bounces the user to the automations → integrations page.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const errorParam = url.searchParams.get("error");
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");

    const redirect = (qs: string) => {
      const base = process.env.NEXT_PUBLIC_SITE_URL ?? url.origin;
      return NextResponse.redirect(`${base}/dashboard/oauth-result?from=integration${qs}`);
    };

    if (errorParam) return redirect(`&error=${encodeURIComponent(errorParam)}`);
    if (!state || !code) throw new HttpError(400, "missing state or code in oauth callback");

    const { data: stateRow } = await supabaseAdmin()
      .from("oauth_states")
      .select("tenant_id, provider_type, integration_name")
      .eq("state", state)
      .maybeSingle();
    if (!stateRow) throw new HttpError(400, "invalid oauth state");

    const provider = stateRow.provider_type as OAuthProviderType;
    const providerConfig = OAUTH_PROVIDERS[provider];
    if (!providerConfig) throw new HttpError(400, `unknown oauth provider: ${provider}`);

    const clientId = process.env[providerConfig.clientIdEnv];
    const clientSecret = process.env[providerConfig.clientSecretEnv];
    if (!clientId || !clientSecret) {
      throw new HttpError(
        500,
        `${providerConfig.clientIdEnv}/${providerConfig.clientSecretEnv} are not configured`,
      );
    }

    const tokenRes = await fetch(providerConfig.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${url.origin}/api/auth/oauth/callback`,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new HttpError(502, `oauth token exchange failed: ${tokenRes.status} ${text.slice(0, 400)}`);
    }

    const tokens = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!tokens.access_token) throw new HttpError(502, "oauth token exchange returned no access_token");
    if (!tokens.refresh_token) throw new HttpError(502, "oauth token exchange returned no refresh_token");

    const integration = await createIntegration(stateRow.tenant_id, {
      name: stateRow.integration_name || provider,
      type: provider,
      config: providerConfig.extractExtra(url.searchParams),
    });

    await updateIntegrationCredentials(integration.id, stateRow.tenant_id, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: typeof tokens.expires_in === "number" ? Date.now() + tokens.expires_in * 1000 : undefined,
    });

    await (await supabaseAdmin().from("oauth_states").delete().eq("state", state));

    return redirect(
      `&tenantId=${stateRow.tenant_id}&success=1&name=${encodeURIComponent(integration.name)}`,
    );
  } catch (e) {
    if (e instanceof HttpError) {
      const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
      return NextResponse.redirect(
        `${base}/dashboard/oauth-result?from=integration&error=${encodeURIComponent(e.message)}`,
      );
    }
    return handleError(e);
  }
}