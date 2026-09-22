import {
  getDataSourceActionAvailability,
  getDataSourceReadinessReason,
  isDataSourceConfigurationReady,
  isDataSourceIntegrationReady,
  resolveDataSourceReadinessReason,
} from './readiness';

describe('getDataSourceReadinessReason', () => {
  it('returns a reason when there is no integration', () => {
    expect(getDataSourceReadinessReason({}, new Map())).toBe(
      'No integration selected',
    );
  });

  it('returns missing secret count when required secrets are absent', () => {
    expect(
      getDataSourceReadinessReason(
        {
          integrationId: 'int-gh',
          integration: {
            id: 'int-gh',
            readyForCurrentScope: true,
          },
        },
        new Map([
          [
            'int-gh',
            {
              requiredSecretRefs: ['GITHUB_TOKEN'],
              missingSecretRefs: ['GITHUB_TOKEN'],
              hasRequiredConfig: true,
              configured: false,
            },
          ],
        ]),
      ),
    ).toBe('1 required secret missing');
  });

  it('returns unavailable when the integration cannot be resolved', () => {
    expect(
      getDataSourceReadinessReason(
        {
          integrationId: 'int-gh',
          integration: undefined,
        },
        new Map(),
      ),
    ).toBe('Selected integration is unavailable');
  });

  it('returns undefined when the integration is ready', () => {
    expect(
      getDataSourceReadinessReason(
        {
          integrationId: 'int-gh',
          integration: {
            id: 'int-gh',
            readyForCurrentScope: true,
          },
        },
        new Map([
          [
            'int-gh',
            {
              requiredSecretRefs: ['GITHUB_TOKEN'],
              missingSecretRefs: [],
              hasRequiredConfig: true,
              configured: true,
            },
          ],
        ]),
      ),
    ).toBeUndefined();
  });

  it('returns setup required when readyForCurrentScope is false even if secrets are configured', () => {
    expect(
      getDataSourceReadinessReason(
        {
          integrationId: 'int-gh',
          integration: {
            id: 'int-gh',
            readyForCurrentScope: false,
          },
        },
        new Map([
          [
            'int-gh',
            {
              requiredSecretRefs: ['GITHUB_TOKEN'],
              missingSecretRefs: [],
              hasRequiredConfig: true,
              configured: true,
            },
          ],
        ]),
        false,
      ),
    ).toBe('Integration setup required');
  });

  it('reports the first unready chained integration', () => {
    expect(
      getDataSourceReadinessReason(
        {
          integration: { id: 'int-gh', readyForCurrentScope: true },
          integrations: [
            { id: 'int-gh', readyForCurrentScope: true },
            { id: 'int-pd', readyForCurrentScope: true },
          ],
        },
        new Map([
          [
            'int-gh',
            {
              requiredSecretRefs: [],
              missingSecretRefs: [],
              hasRequiredConfig: true,
              configured: true,
            },
          ],
          [
            'int-pd',
            {
              requiredSecretRefs: ['PD_TOKEN'],
              missingSecretRefs: ['PD_TOKEN'],
              hasRequiredConfig: true,
              configured: false,
            },
          ],
        ]),
      ),
    ).toBe('1 required secret missing');
  });

  it('treats nodeType-only placeholders as unready when integrationId is set', () => {
    expect(
      getDataSourceReadinessReason(
        {
          integrationId: 'int-gh',
          integration: {},
          integrations: [{}],
        },
        new Map(),
      ),
    ).toBe('Selected integration is unavailable');
  });

  it('reports nothing for a fully configured integration-less source', () => {
    expect(
      getDataSourceReadinessReason(
        {
          integration: {},
          integrations: [{}],
          isSourceConfigured: true,
        },
        new Map(),
      ),
    ).toBeUndefined();
  });

  it('reports the source config gap for a half-configured integration-less source', () => {
    expect(
      getDataSourceReadinessReason(
        {
          integration: {},
          integrations: [{}],
          isSourceConfigured: false,
        },
        new Map(),
      ),
    ).toBe('Source endpoint not configured');
  });
});

describe('isDataSourceIntegrationReady', () => {
  it('returns false when the integration is missing', () => {
    expect(isDataSourceIntegrationReady({}, new Map())).toBe(false);
  });

  it('returns false while secret summaries are still loading', () => {
    expect(
      isDataSourceIntegrationReady(
        {
          integration: { id: 'int-gh', readyForCurrentScope: true },
        },
        new Map(),
        true,
      ),
    ).toBe(false);
  });

  it('returns true when secrets are configured', () => {
    expect(
      isDataSourceIntegrationReady(
        {
          integration: { id: 'int-gh', readyForCurrentScope: true },
        },
        new Map([
          [
            'int-gh',
            {
              requiredSecretRefs: ['GITHUB_TOKEN'],
              missingSecretRefs: [],
              hasRequiredConfig: true,
              configured: true,
            },
          ],
        ]),
      ),
    ).toBe(true);
  });

  it('treats an integration-less source (e.g. source-datastore) as ready', () => {
    expect(
      isDataSourceIntegrationReady({ integrations: [{}] }, new Map()),
    ).toBe(true);
  });

  it('stays unready when an integrationId is configured but unresolvable', () => {
    expect(
      isDataSourceIntegrationReady(
        { integrationId: 'int-deleted', integrations: [{}] },
        new Map(),
      ),
    ).toBe(false);
  });

  it('returns false when a chained integration is not ready', () => {
    expect(
      isDataSourceIntegrationReady(
        {
          integration: { id: 'int-gh', readyForCurrentScope: true },
          integrations: [
            { id: 'int-gh', readyForCurrentScope: true },
            { id: 'int-pd', readyForCurrentScope: true },
          ],
        },
        new Map([
          [
            'int-gh',
            {
              requiredSecretRefs: [],
              missingSecretRefs: [],
              hasRequiredConfig: true,
              configured: true,
            },
          ],
          [
            'int-pd',
            {
              requiredSecretRefs: ['PD_TOKEN'],
              missingSecretRefs: ['PD_TOKEN'],
              hasRequiredConfig: true,
              configured: false,
            },
          ],
        ]),
      ),
    ).toBe(false);
  });
});

describe('isDataSourceConfigurationReady', () => {
  it('returns false when the source endpoint is not configured', () => {
    expect(
      isDataSourceConfigurationReady(
        {
          integration: { id: 'int-gh', readyForCurrentScope: true },
          isSourceConfigured: false,
        },
        new Map([
          [
            'int-gh',
            {
              requiredSecretRefs: ['GITHUB_TOKEN'],
              missingSecretRefs: [],
              hasRequiredConfig: true,
              configured: true,
            },
          ],
        ]),
      ),
    ).toBe(false);
  });

  it('returns true when integration and source are configured', () => {
    expect(
      isDataSourceConfigurationReady(
        {
          integration: { id: 'int-gh', readyForCurrentScope: true },
          isSourceConfigured: true,
        },
        new Map([
          [
            'int-gh',
            {
              requiredSecretRefs: ['GITHUB_TOKEN'],
              missingSecretRefs: [],
              hasRequiredConfig: true,
              configured: true,
            },
          ],
        ]),
      ),
    ).toBe(true);
  });
});

describe('resolveDataSourceReadinessReason', () => {
  it('looks up the integration summary from the map', () => {
    expect(
      resolveDataSourceReadinessReason(
        {
          integrationId: 'int-gh',
          integration: { id: 'int-gh', readyForCurrentScope: true },
        },
        new Map([
          [
            'int-gh',
            {
              requiredSecretRefs: ['GITHUB_TOKEN'],
              missingSecretRefs: ['GITHUB_TOKEN'],
              hasRequiredConfig: true,
              configured: false,
            },
          ],
        ]),
      ),
    ).toBe('1 required secret missing');
  });
});

describe('getDataSourceActionAvailability', () => {
  it('blocks run and enable when not fully configured, surfacing the reason', () => {
    expect(
      getDataSourceActionAvailability({
        enabled: false,
        readinessReason: 'Integration setup required',
      }),
    ).toEqual({
      canRun: false,
      canEnable: false,
      canToggle: false,
      runTooltip: 'Integration setup required',
      toggleTooltip: 'Integration setup required',
    });
  });

  it('allows running a disabled source, and enabling it, once configured', () => {
    expect(getDataSourceActionAvailability({ enabled: false })).toEqual({
      canRun: true,
      canEnable: true,
      canToggle: true,
      runTooltip: 'Runs the last saved version',
      toggleTooltip: 'Enables scheduled runs of the last saved version',
    });
  });

  it('shows the disable hint for an enabled, configured source', () => {
    expect(getDataSourceActionAvailability({ enabled: true })).toEqual({
      canRun: true,
      canEnable: true,
      canToggle: true,
      runTooltip: 'Runs the last saved version',
      toggleTooltip: 'Stops the schedule',
    });
  });

  it('blocks run but still allows disabling an enabled, unconfigured source', () => {
    const result = getDataSourceActionAvailability({
      enabled: true,
      readinessReason: '1 required secret missing',
    });
    expect(result.canRun).toBe(false);
    expect(result.canEnable).toBe(false);
    expect(result.runTooltip).toBe('1 required secret missing');
    // An already-enabled source may still be disabled even when misconfigured.
    expect(result.canToggle).toBe(true);
    expect(result.toggleTooltip).toBe('Stops the schedule');
  });

  it('blocks run while a run is already in flight', () => {
    const result = getDataSourceActionAvailability({
      enabled: true,
      isRunning: true,
    });
    expect(result.canRun).toBe(false);
    expect(result.runTooltip).toBe('A run is already in progress');
  });

  it('blocks toggling while a toggle is already in flight', () => {
    const result = getDataSourceActionAvailability({
      enabled: true,
      isToggling: true,
    });
    expect(result.canEnable).toBe(false);
    expect(result.canToggle).toBe(false);
    expect(result.toggleTooltip).toBe('An update is already in progress');
  });
});
