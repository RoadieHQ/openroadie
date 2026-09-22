import type { Request } from 'express';
import type { HttpAuthService, RoadieCredentials } from './types';
import {
  UNATTRIBUTED,
  callerAttribution,
  callerPrincipal,
} from './callerPrincipal';

const req = {} as Request;

function httpAuthReturning(principal: unknown): HttpAuthService {
  return {
    credentials: async () =>
      ({
        $$type: '@roadiehq/RoadieCredentials',
        principal,
      }) as RoadieCredentials<never>,
    issueUserCookie: async () => ({ expiresAt: new Date(0) }),
  } as unknown as HttpAuthService;
}

const throwingHttpAuth: HttpAuthService = {
  credentials: async () => {
    throw new Error('no credentials');
  },
  issueUserCookie: async () => ({ expiresAt: new Date(0) }),
} as unknown as HttpAuthService;

describe('callerPrincipal', () => {
  it('returns the user principal for an identified caller', async () => {
    const principal = await callerPrincipal(
      httpAuthReturning({ type: 'user', userId: 'auth0|622b' }),
      req,
    );

    expect(principal?.userId).toBe('auth0|622b');
  });

  // Authorization reads this as "owns nothing", so the distinction between a
  // service token, an anonymous caller and a broken credential must collapse
  // to the same absent identity rather than to three sentinels.
  it.each([
    ['a service principal', { type: 'service', subject: 'rst:34abaa61' }],
    ['no principal', { type: 'none' }],
  ])('returns undefined for %s', async (_label, principal) => {
    expect(
      await callerPrincipal(httpAuthReturning(principal), req),
    ).toBeUndefined();
  });

  it('returns undefined when reading credentials throws', async () => {
    expect(await callerPrincipal(throwingHttpAuth, req)).toBeUndefined();
  });
});

describe('callerAttribution', () => {
  it('attributes a user to their own id', async () => {
    await expect(
      callerAttribution(
        httpAuthReturning({ type: 'user', userId: 'alice' }),
        req,
      ),
    ).resolves.toBe('alice');
  });

  // A token-driven write stays traceable to the token that made it rather
  // than collapsing into the unattributed bucket.
  it('attributes a service token to its subject', async () => {
    await expect(
      callerAttribution(
        httpAuthReturning({ type: 'service', subject: 'rst:34abaa61' }),
        req,
      ),
    ).resolves.toBe('service:rst:34abaa61');
  });

  it.each([
    ['there is no principal', httpAuthReturning({ type: 'none' })],
    ['reading credentials throws', throwingHttpAuth],
  ])('records %s as unattributed', async (_label, httpAuth) => {
    await expect(callerAttribution(httpAuth, req)).resolves.toBe(UNATTRIBUTED);
  });
});
