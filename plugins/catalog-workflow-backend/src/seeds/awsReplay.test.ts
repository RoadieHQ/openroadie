import { describe, expect, it } from 'vitest';
import { loadSeeds, seedByName } from './replayHarness.test-utils';

const seeds = loadSeeds('aws');

describe('aws seed replay definitions', () => {
  it('loads representative AWS seed patterns through the replay harness loader', () => {
    const serviceApi = seedByName(seeds, 'AWS RDS DB instances').build(
      'integration-aws',
    );
    const chained = seedByName(seeds, 'AWS EKS clusters').build(
      'integration-aws',
    );
    const cloudControl = seedByName(seeds, 'AWS App Runner services').build(
      'integration-aws',
    );
    const configuredAccounts = seedByName(seeds, 'AWS accounts').build(
      'integration-aws',
    );

    expect(serviceApi.nodes.map(node => node.type)).toEqual([
      'trigger-schedule',
      'source-integration',
      'sink-datastore',
    ]);
    expect(chained.nodes.map(node => node.type)).toEqual([
      'trigger-schedule',
      'source-integration',
      'source-chained',
      'sink-datastore',
    ]);
    expect(cloudControl.nodes.map(node => node.type)).toEqual([
      'trigger-schedule',
      'source-integration',
      'sink-datastore',
    ]);
    expect(
      configuredAccounts.nodes.find(node => node.type === 'source-integration'),
    ).toMatchObject({
      data: {
        config: {
          backendType: 'aws',
          mode: 'configured-accounts',
          integrationId: 'integration-aws',
        },
      },
    });
  });
});
