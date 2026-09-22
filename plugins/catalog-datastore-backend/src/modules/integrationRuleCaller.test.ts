import { describe, expect, it, vi } from 'vitest';
import { makeIntegrationRuleCaller } from './integrationRuleCaller';

describe('makeIntegrationRuleCaller', () => {
  it('scopes integration requests to the relationship workspace', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const callIntegration = makeIntegrationRuleCaller({ request });

    await callIntegration({
      integrationId: 'integration-a',
      method: 'get',
      path: '/objects/1',
      workspaceId: 'workspace-b',
    });

    expect(request).toHaveBeenCalledWith('integration-a', {
      backendType: 'http',
      method: 'GET',
      path: '/objects/1',
      workspaceId: 'workspace-b',
    });
  });
});
