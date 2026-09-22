import { lookup as dnsLookup, type LookupOptions } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';

const BLOCKED_HOSTNAME_SUFFIXES = [
  '.svc.cluster.local',
  '.cluster.local',
  '.internal',
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'kubernetes',
  'kubernetes.default',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
  'metadata.google.internal',
]);

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) return false;
  const [a, b] = parts;
  return (
    a === 127 || // loopback 127.0.0.0/8
    a === 10 || // RFC 1918 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918 172.16.0.0/12
    (a === 192 && b === 168) || // RFC 1918 192.168.0.0/16
    (a === 169 && b === 254) || // link-local / cloud metadata 169.254.0.0/16
    a === 0 || // "this" network 0.0.0.0/8
    (a === 100 && b >= 64 && b <= 127) // CGNAT 100.64.0.0/10
  );
}

export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' || // loopback
    normalized === '::' || // unspecified
    normalized.startsWith('fc') || // unique local fc00::/7
    normalized.startsWith('fd') || // unique local
    normalized.startsWith('fe80') // link-local fe80::/10
  );
}

function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some(suffix => lower.endsWith(suffix));
}

/**
 * Validates that a URL does not target localhost, private networks, or
 * cluster-internal services. Throws if the URL is blocked.
 *
 * This performs static checks only (hostname patterns and IP literals).
 * For DNS-level protection against rebinding, use {@link createSsrfGuardedLookup}
 * as the undici Agent's `lookup` function.
 */
export function assertSafeUrl(url: string): void {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Integration request blocked: disallowed protocol ${parsed.protocol}`,
    );
  }

  if (isBlockedHostname(hostname)) {
    throw new Error(
      `Integration request blocked: restricted hostname "${hostname}"`,
    );
  }

  if (isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error(
      `Integration request blocked: private IP address "${hostname}"`,
    );
  }
}

/**
 * Returns true if `hostname` matches any pattern in `allowedPatterns`.
 *
 * Patterns are either exact hostnames (`grafana.corp.example.com`) or
 * wildcard-prefix patterns (`*.eks.amazonaws.com`).  Matching is
 * case-insensitive.
 */
export function matchesHostAllowlist(
  hostname: string,
  allowedPatterns: string[],
): boolean {
  if (allowedPatterns.length === 0) return false;
  const lower = hostname.toLowerCase();
  return allowedPatterns.some(pattern => {
    const p = pattern.toLowerCase().trim();
    if (p.startsWith('*.')) {
      const suffix = p.slice(1); // e.g. '.eks.amazonaws.com'
      return lower.endsWith(suffix) || lower === p.slice(2);
    }
    return lower === p;
  });
}

/**
 * Returns a DNS lookup function compatible with undici's
 * `Agent({ connect: { lookup } })`.
 *
 * It delegates to the system resolver and then validates that the
 * resolved address is not in a private/internal range, preventing DNS
 * rebinding attacks.
 *
 * Dangerous hostnames (localhost, cluster-internal names) are always
 * blocked regardless of the allowlist.  Hostnames that match
 * `privateIpAllowedHosts` are permitted to resolve to private IPs
 * (needed for platform integrations like EKS whose API servers use
 * split-horizon DNS).
 */
export function createSsrfGuardedLookup(
  privateIpAllowedHosts?: string[],
): LookupFunction {
  const allowedHosts = privateIpAllowedHosts ?? [];
  return (
    hostname: string,
    options: LookupOptions,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string,
      family: number,
    ) => void,
  ): void => {
    if (isBlockedHostname(hostname)) {
      const blocked: NodeJS.ErrnoException = new Error(
        `Integration request blocked: restricted hostname "${hostname}"`,
      );
      blocked.code = 'ENOTFOUND';
      callback(blocked, '', 0);
      return;
    }

    // Force single-address resolution.  Callers MUST set
    // `autoSelectFamily: false` on the undici Agent — Node 20+ defaults
    // autoSelectFamily to true, which calls lookup with `all: true` and
    // expects an array result, incompatible with this single-address guard.
    dnsLookup(hostname, { ...options, all: false }, (err, address, family) => {
      if (err) {
        callback(err, address, family);
        return;
      }
      if (
        isPrivateIp(address) &&
        !matchesHostAllowlist(hostname, allowedHosts)
      ) {
        const blocked: NodeJS.ErrnoException = new Error(
          `Integration request blocked: "${hostname}" resolved to private IP ${address}`,
        );
        blocked.code = 'ENOTFOUND';
        callback(blocked, address, family);
        return;
      }
      callback(null, address, family);
    });
  };
}
