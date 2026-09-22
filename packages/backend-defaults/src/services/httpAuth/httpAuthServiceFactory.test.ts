import type { Request } from 'express';
import { callerPrincipal } from '@roadiehq/extensions-api';
import { httpAuthServiceFactory } from './httpAuthServiceFactory';

async function service() {
  // The factory takes a discovery dep it never reads.
  return (httpAuthServiceFactory as any).factory({});
}

describe('the default httpAuth service', () => {
  // Personal workspaces are uncreatable without an identified caller, so a
  // deployment with no identity provider still has to resolve to *someone*.
  it('resolves every caller to the guest user', async () => {
    const httpAuth = await service();

    const principal = await callerPrincipal(httpAuth, {} as Request);

    expect(principal).toEqual({ type: 'user', userId: 'guest' });
  });
});
