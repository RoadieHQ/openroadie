import { describe, expect, it } from 'vitest';
import { INITIAL_VIEW, defaultIds, menuStages, viewFromConnect } from './types';
import type { ConnectResult } from './bridge';

function connectResult(overrides: Partial<ConnectResult>): ConnectResult {
  return {
    connected: false,
    status: 'pending',
    needs: null,
    secretName: null,
    secretNames: [],
    reason: null,
    ...overrides,
  };
}

describe('setup connect view mapping', () => {
  it('starts in the working phase while enable/connect is in flight', () => {
    expect(INITIAL_VIEW).toEqual({
      phase: 'working',
      secretName: null,
      secretNames: [],
      secretIndex: 0,
      message: null,
      appSetupUrl: null,
      appSetupOpened: false,
    });
  });

  it('maps a user-secret result to a token prompt with the real secret name', () => {
    expect(
      viewFromConnect(
        connectResult({
          needs: 'user-secret',
          secretName: 'GITHUB_TOKEN',
          secretNames: ['GITHUB_TOKEN'],
          reason: 'GitHub needs its secret.',
        }),
      ),
    ).toEqual({
      phase: 'needs-token',
      secretName: 'GITHUB_TOKEN',
      secretNames: ['GITHUB_TOKEN'],
      secretIndex: 0,
      message: 'GitHub needs its secret.',
      appSetupUrl: null,
      appSetupOpened: false,
    });
  });

  it('maps GitHub App install needs to browser app setup', () => {
    expect(
      viewFromConnect(
        connectResult({
          needs: 'github-app-install',
          reason: 'Install the GitHub App in OpenRoadie first.',
        }),
      ),
    ).toEqual({
      phase: 'app-setup',
      secretName: null,
      secretNames: [],
      secretIndex: 0,
      message: 'Install the GitHub App in OpenRoadie first.',
      appSetupUrl: null,
      appSetupOpened: false,
    });
  });

  it('keeps unresolved non-blocked pending states retryable as manual', () => {
    expect(
      viewFromConnect(
        connectResult({
          status: 'failed',
          needs: 'integration-not-enabled',
          reason: null,
        }),
      ),
    ).toEqual({
      phase: 'manual',
      secretName: null,
      secretNames: [],
      secretIndex: 0,
      message: 'Not connected yet (integration-not-enabled).',
      appSetupUrl: null,
      appSetupOpened: false,
    });
  });

  it('pre-selects nothing — the Integrations stage is the picker', () => {
    expect(defaultIds.size).toBe(0);
    expect(menuStages).toEqual(['Integrations', 'Connect']);
  });
});
