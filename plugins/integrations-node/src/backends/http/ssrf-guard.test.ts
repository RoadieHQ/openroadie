import { lookup as dnsLookup, LookupAddress } from 'node:dns';
import { describe, expect, it, vi } from 'vitest';
import {
  assertSafeUrl,
  createSsrfGuardedLookup,
  isPrivateIPv4,
  isPrivateIPv6,
  matchesHostAllowlist,
} from './ssrf-guard';

vi.mock('node:dns', () => ({
  lookup: vi.fn(),
}));

const mockDnsLookup = vi.mocked(dnsLookup);

describe('isPrivateIPv4', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.255',
    '10.0.0.1',
    '10.255.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.168.1.100',
    '169.254.169.254',
    '169.254.0.1',
    '0.0.0.0',
    '100.64.0.1',
    '100.127.255.255',
  ])('returns true for private IP %s', ip => {
    expect(isPrivateIPv4(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.0.1',
    '100.63.255.255',
    '100.128.0.0',
    '169.255.0.1',
    '52.94.76.1',
  ])('returns false for public IP %s', ip => {
    expect(isPrivateIPv4(ip)).toBe(false);
  });
});

describe('isPrivateIPv6', () => {
  it.each(['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1'])(
    'returns true for private IPv6 %s',
    ip => {
      expect(isPrivateIPv6(ip)).toBe(true);
    },
  );

  it.each(['2001:db8::1', '2607:f8b0:4004:800::200e'])(
    'returns false for public IPv6 %s',
    ip => {
      expect(isPrivateIPv6(ip)).toBe(false);
    },
  );
});

describe('assertSafeUrl', () => {
  it('allows public URLs', () => {
    expect(() => assertSafeUrl('https://api.github.com/repos')).not.toThrow();
    expect(() => assertSafeUrl('https://example.com/path')).not.toThrow();
    expect(() => assertSafeUrl('http://8.8.8.8/test')).not.toThrow();
  });

  it('blocks localhost', () => {
    expect(() => assertSafeUrl('http://localhost/test')).toThrow(
      /restricted hostname/,
    );
    expect(() => assertSafeUrl('http://localhost:8080/test')).toThrow(
      /restricted hostname/,
    );
  });

  it('blocks loopback IPs', () => {
    expect(() => assertSafeUrl('http://127.0.0.1/test')).toThrow(/private IP/);
    expect(() => assertSafeUrl('http://127.0.0.1:3000/test')).toThrow(
      /private IP/,
    );
  });

  it('blocks RFC 1918 ranges', () => {
    expect(() => assertSafeUrl('http://10.0.0.1/test')).toThrow(/private IP/);
    expect(() => assertSafeUrl('http://172.16.0.1/test')).toThrow(/private IP/);
    expect(() => assertSafeUrl('http://192.168.1.1/test')).toThrow(
      /private IP/,
    );
  });

  it('blocks cloud metadata endpoint', () => {
    expect(() => assertSafeUrl('http://169.254.169.254/latest')).toThrow(
      /private IP/,
    );
  });

  it('blocks Kubernetes internal hostnames', () => {
    expect(() =>
      assertSafeUrl('http://my-service.default.svc.cluster.local/api'),
    ).toThrow(/restricted hostname/);
    expect(() => assertSafeUrl('http://kubernetes.default.svc/api')).toThrow(
      /restricted hostname/,
    );
    expect(() => assertSafeUrl('http://kubernetes/api')).toThrow(
      /restricted hostname/,
    );
  });

  it('blocks .internal hostnames', () => {
    expect(() =>
      assertSafeUrl('http://metadata.google.internal/computeMetadata'),
    ).toThrow(/restricted hostname/);
    expect(() => assertSafeUrl('http://some-service.internal/api')).toThrow(
      /restricted hostname/,
    );
  });

  it('blocks IPv6 loopback', () => {
    expect(() => assertSafeUrl('http://[::1]/test')).toThrow(/private IP/);
  });

  it('blocks non-http protocols', () => {
    expect(() => assertSafeUrl('file:///etc/passwd')).toThrow(
      /disallowed protocol/,
    );
    expect(() => assertSafeUrl('ftp://internal/file')).toThrow(
      /disallowed protocol/,
    );
  });

  it('blocks CGNAT range', () => {
    expect(() => assertSafeUrl('http://100.64.0.1/test')).toThrow(/private IP/);
    expect(() => assertSafeUrl('http://100.100.100.100/test')).toThrow(
      /private IP/,
    );
  });

  it('allows IPs just outside private ranges', () => {
    expect(() => assertSafeUrl('http://172.32.0.1/test')).not.toThrow();
    expect(() => assertSafeUrl('http://100.128.0.1/test')).not.toThrow();
    expect(() => assertSafeUrl('http://192.169.0.1/test')).not.toThrow();
  });
});

describe('matchesHostAllowlist', () => {
  it('returns false for empty allowlist', () => {
    expect(matchesHostAllowlist('anything.com', [])).toBe(false);
  });

  it('matches exact hostnames (case-insensitive)', () => {
    const patterns = ['grafana.corp.example.com'];
    expect(matchesHostAllowlist('grafana.corp.example.com', patterns)).toBe(
      true,
    );
    expect(matchesHostAllowlist('Grafana.Corp.Example.Com', patterns)).toBe(
      true,
    );
    expect(matchesHostAllowlist('other.example.com', patterns)).toBe(false);
  });

  it('matches wildcard-prefix patterns', () => {
    const patterns = ['*.eks.amazonaws.com'];
    expect(
      matchesHostAllowlist('abc123.gr7.us-east-1.eks.amazonaws.com', patterns),
    ).toBe(true);
    expect(matchesHostAllowlist('eks.amazonaws.com', patterns)).toBe(true);
    expect(matchesHostAllowlist('amazonaws.com', patterns)).toBe(false);
    expect(
      matchesHostAllowlist('evil.eks.amazonaws.com.attacker.com', patterns),
    ).toBe(false);
  });

  it('matches multiple patterns', () => {
    const patterns = ['*.eks.amazonaws.com', '*.elb.amazonaws.com'];
    expect(matchesHostAllowlist('my-cluster.eks.amazonaws.com', patterns)).toBe(
      true,
    );
    expect(matchesHostAllowlist('my-lb.elb.amazonaws.com', patterns)).toBe(
      true,
    );
    expect(matchesHostAllowlist('s3.amazonaws.com', patterns)).toBe(false);
  });

  it('trims whitespace from patterns', () => {
    const patterns = ['  *.eks.amazonaws.com  '];
    expect(matchesHostAllowlist('cluster.eks.amazonaws.com', patterns)).toBe(
      true,
    );
  });
});

describe('createSsrfGuardedLookup', () => {
  function invokeLookup(
    lookup: ReturnType<typeof createSsrfGuardedLookup>,
    hostname: string,
  ): Promise<{
    err: NodeJS.ErrnoException | null;
    address: string | LookupAddress[];
    family?: number;
  }> {
    return new Promise(resolve => {
      lookup(hostname, { family: 0 }, (err, address, family) => {
        resolve({ err, address, family });
      });
    });
  }

  function mockResolve(address: string, family: number) {
    mockDnsLookup.mockImplementation(((
      _h: unknown,
      _o: unknown,
      cb: (p: null, address: string, family: number) => void,
    ) => cb(null, address, family)) as any);
  }

  it('blocks hostnames in the blocked list', async () => {
    const lookup = createSsrfGuardedLookup();
    const result = await invokeLookup(lookup, 'localhost');
    expect(result.err).toBeTruthy();
    expect(result.err?.message).toMatch(/restricted hostname/);
    expect(result.err?.code).toBe('ENOTFOUND');
    // DNS should not even be called for blocked hostnames
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it('blocks cluster-internal hostnames', async () => {
    const lookup = createSsrfGuardedLookup();
    const result = await invokeLookup(
      lookup,
      'my-svc.default.svc.cluster.local',
    );
    expect(result.err).toBeTruthy();
    expect(result.err?.message).toMatch(/restricted hostname/);
  });

  it('blocks private IP resolution by default', async () => {
    mockResolve('10.0.0.1', 4);
    const lookup = createSsrfGuardedLookup();
    const result = await invokeLookup(lookup, 'evil.example.com');
    expect(result.err).toBeTruthy();
    expect(result.err?.message).toMatch(/private IP/);
    expect(result.err?.code).toBe('ENOTFOUND');
  });

  it('allows private IP resolution for allowlisted hosts', async () => {
    mockResolve('10.0.0.1', 4);
    const lookup = createSsrfGuardedLookup(['*.eks.amazonaws.com']);
    const result = await invokeLookup(
      lookup,
      'my-cluster.gr7.us-east-1.eks.amazonaws.com',
    );
    expect(result.err).toBeNull();
    expect(result.address).toBe('10.0.0.1');
  });

  it('still blocks private IP for non-allowlisted hosts', async () => {
    mockResolve('10.0.0.1', 4);
    const lookup = createSsrfGuardedLookup(['*.eks.amazonaws.com']);
    const result = await invokeLookup(lookup, 'evil.example.com');
    expect(result.err).toBeTruthy();
    expect(result.err?.message).toMatch(/private IP/);
  });

  it('blocked hostnames are rejected even if allowlisted', async () => {
    const lookup = createSsrfGuardedLookup(['localhost', '*.cluster.local']);
    const result1 = await invokeLookup(lookup, 'localhost');
    expect(result1.err).toBeTruthy();
    expect(result1.err?.message).toMatch(/restricted hostname/);

    const result2 = await invokeLookup(lookup, 'svc.default.svc.cluster.local');
    expect(result2.err).toBeTruthy();
    expect(result2.err?.message).toMatch(/restricted hostname/);
  });

  it('allows public IP resolution regardless of allowlist', async () => {
    mockResolve('52.94.76.1', 4);
    const lookup = createSsrfGuardedLookup();
    const result = await invokeLookup(lookup, 'api.github.com');
    expect(result.err).toBeNull();
    expect(result.address).toBe('52.94.76.1');
  });

  it('forwards DNS resolution errors', async () => {
    const dnsErr: NodeJS.ErrnoException = new Error('getaddrinfo ENOTFOUND');
    dnsErr.code = 'ENOTFOUND';
    mockDnsLookup.mockImplementation(((
      _h: unknown,
      _o: unknown,
      cb: (p: NodeJS.ErrnoException, address: string, family: number) => void,
    ) => cb(dnsErr, '', 0)) as any);
    const lookup = createSsrfGuardedLookup();
    const result = await invokeLookup(lookup, 'does-not-exist.example.com');
    expect(result.err).toBeTruthy();
    expect(result.err?.message).toMatch(/getaddrinfo/);
  });
});
