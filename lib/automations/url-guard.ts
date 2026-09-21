import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";
import { NonRetriableError } from "inngest";

/**
 * SSRF guard for `api_call` steps (lib/automations/url-guard.ts).
 *
 * `resolveTarget()` resolves a step's URL — optionally against an integration's
 * `base_url` — and rejects anything that is not HTTPS pointing at a public
 * address, so a tenant can never reach a private/metadata endpoint through the
 * executor. Violations are config problems, not transient failures, so they
 * throw NonRetriableError and Inngest skips retrying.
 */

const PRIVATE = new BlockList();
PRIVATE.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("169.254.0.0", 16, "ipv4"); // cloud metadata endpoints
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE.addSubnet("::1", 128, "ipv6");
PRIVATE.addSubnet("fc00::", 7, "ipv6");
PRIVATE.addSubnet("fe80::", 10, "ipv6");

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/**
 * Resolve `rawTarget` (absolute, or relative to `base` when given) and enforce
 * the SSRF rules described above. Returns the resolved URL.
 */
export async function resolveTarget(rawTarget: string, base?: string | null): Promise<URL> {
  const baseUrl = base && base.trim() ? new URL(base) : null;
  let target: URL;
  try {
    target = baseUrl ? new URL(rawTarget, baseUrl) : new URL(rawTarget);
  } catch {
    throw new NonRetriableError("api_call blocked: invalid URL");
  }

  // An integration's step URL must stay on the integration's origin.
  if (baseUrl && target.origin !== baseUrl.origin) {
    throw new NonRetriableError("api_call blocked: target must stay on the integration's origin");
  }

  // Developer carve-out: local HTTP endpoints for local testing. Everything
  // else (including production) must be HTTPS.
  if (isLoopbackHost(target.hostname) && process.env.NODE_ENV !== "production") {
    return target;
  }
  if (target.protocol !== "https:") {
    throw new NonRetriableError("api_call blocked: https is required");
  }

  // Resolve the hostname and reject every result that lands on a private
  // address (direct literals, DNS-rebinding style lookups, IPv4-mapped IPv6).
  let addresses: { address: string; family: number }[];
  try {
    addresses = (await lookup(target.hostname, { all: true })) as { address: string; family: number }[];
  } catch {
    throw new NonRetriableError(`api_call blocked: could not resolve host ${target.hostname}`);
  }

  for (const { address, family } of addresses) {
    const mapped = address.toLowerCase().startsWith("::ffff:");
    const checkAgainst = mapped ? address.slice("::ffff:".length) : address;
    if (PRIVATE.check(checkAgainst, mapped || family === 4 ? "ipv4" : "ipv6")) {
      throw new NonRetriableError(`api_call blocked: ${target.hostname} resolves to a private address`);
    }
  }

  return target;
}