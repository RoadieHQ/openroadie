import { describe, expect, it } from 'vitest';
import { entityChangeTopics } from '@roadiehq/backend-defaults';
import {
  shouldDeliverEntityChange,
  toBrowserEntityChange,
} from './entity-change-stream';

const workspaceId = '22222222-2222-4222-8222-222222222222';

describe('toBrowserEntityChange', () => {
  it.each([
    [entityChangeTopics.actions, 'actions'],
    [entityChangeTopics.capabilities, 'capabilities'],
    [entityChangeTopics.workflows, 'workflows'],
  ] as const)('maps %s events without exposing entity ids', (topic, entity) => {
    expect(
      toBrowserEntityChange({
        topic,
        eventPayload: {
          id: 'private-entity-id',
          operation: 'updated',
          scopeId: 'tenant-a',
          workspaceId,
        },
      }),
    ).toEqual({
      entity,
      operation: 'updated',
      scopeId: 'tenant-a',
      workspaceId,
    });
  });

  it('delivers changes only to connections in the same workspace', () => {
    const change = {
      entity: 'actions' as const,
      operation: 'updated' as const,
      scopeId: 'tenant-a',
      workspaceId,
    };

    expect(shouldDeliverEntityChange(change, 'tenant-a', workspaceId)).toBe(
      true,
    );
    expect(
      shouldDeliverEntityChange(
        change,
        'tenant-a',
        '33333333-3333-4333-8333-333333333333',
      ),
    ).toBe(false);
    expect(shouldDeliverEntityChange(change, 'tenant-b', workspaceId)).toBe(
      false,
    );
  });

  it('ignores unrelated or malformed events', () => {
    expect(
      toBrowserEntityChange({
        topic: 'unrelated',
        eventPayload: { operation: 'updated' },
      }),
    ).toBeUndefined();
    expect(
      toBrowserEntityChange({
        topic: entityChangeTopics.actions,
        eventPayload: { operation: 'unknown' },
      }),
    ).toBeUndefined();
  });
});
