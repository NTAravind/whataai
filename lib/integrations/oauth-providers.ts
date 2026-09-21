/**
 * Provider registry for generic OAuth2 "authorization code" flows.
 *
 * THE ONLY FILE that changes when adding a provider. Every OAuth2 provider —
 * Zoho, QuickBooks, Xero, … — follows the identical redirect → code →
 * token-exchange → refresh shape. The routes, state table, encryption, and
 * refresh logic never change per provider; the differences (the two URLs, the
 * scopes, and at most one extra non-token field in the callback) all live here
 * in a single object.
 */

export interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Extra query params on the authorize URL (e.g. `access_type`, `prompt`). */
  extraAuthParams?: Record<string, string>;
  clientIdEnv: string;
  clientSecretEnv: string;
  /**
   * Some providers hand back a field in the callback query string that is not
   * a token (QuickBooks' `realmId` identifies which company was authorized).
   * The result is stored in `integrations.config` (not encrypted) — it's not
   * secret.
   */
  extractExtra: (cb: URLSearchParams) => Record<string, string>;
}

export const OAUTH_PROVIDERS = {
  zoho_invoice: {
    authorizeUrl: "https://accounts.zoho.com/oauth/v2/auth",
    tokenUrl: "https://accounts.zoho.com/oauth/v2/token",
    scopes: ["ZohoInvoice.invoices.CREATE", "ZohoInvoice.invoices.READ"],
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    clientIdEnv: "ZOHO_CLIENT_ID",
    clientSecretEnv: "ZOHO_CLIENT_SECRET",
    extractExtra: () => ({}),
  },
  quickbooks: {
    authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    scopes: ["com.intuit.quickbooks.accounting"],
    extraAuthParams: {},
    clientIdEnv: "QUICKBOOKS_CLIENT_ID",
    clientSecretEnv: "QUICKBOOKS_CLIENT_SECRET",
    extractExtra: (cb: URLSearchParams) => {
      const realmId = cb.get("realmId");
      return realmId ? { realmId } : {};
    },
  },
} as const;

export type OAuthProviderType = keyof typeof OAUTH_PROVIDERS;

export function isOAuthProviderType(type: string): type is string & keyof typeof OAUTH_PROVIDERS {
  return type in OAUTH_PROVIDERS;
}