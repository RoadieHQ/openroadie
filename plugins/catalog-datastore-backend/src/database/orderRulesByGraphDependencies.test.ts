import { mockServices } from '@roadiehq/backend-test-utils';
import { orderRulesByGraphDependencies } from './orderRulesByGraphDependencies';
import type { RelationshipRule } from './types';
import type { IntegrationBackedConfig } from '@roadiehq/catalog-datastore-common';

function rule(
  id: string,
  overrides: Partial<RelationshipRule> = {},
): RelationshipRule {
  return {
    id,
    name: id,
    description: null,
    sourceDatasourceId: 'src-ds',
    targetDatasourceId: 'tgt-ds',
    sourceFieldExpression: '$.a',
    targetFieldExpression: '$.b',
    sourceFilterExpression: null,
    targetFilterExpression: null,
    relationshipType: `type-${id}`,
    reciprocalRelationshipType: null,
    strategy: 'field-matching',
    matchStrategy: 'exact',
    origin: 'test',
    state: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function contextRule(
  id: string,
  options: {
    relationshipType?: string;
    consumedTypes?: string[];
  } = {},
): RelationshipRule {
  const integrationConfig: IntegrationBackedConfig = {
    integrationId: 'integration-1',
    path: '/lookup/{value}',
    pathExpression: '"/lookup/" & sourceValue',
    sourceContext: {
      maxDepth: 1,
      ...(options.consumedTypes
        ? { relationshipTypes: options.consumedTypes }
        : {}),
    },
    responseMatchExpression: 'name',
  };
  return rule(id, {
    strategy: 'integration-backed',
    relationshipType: options.relationshipType ?? `type-${id}`,
    integrationConfig,
  });
}

function ids(rules: RelationshipRule[]): string[] {
  return rules.map(r => r.id);
}

describe('orderRulesByGraphDependencies', () => {
  it('keeps independent rules in their original order', () => {
    const logger = mockServices.logger.mock();
    const ordered = orderRulesByGraphDependencies(
      [rule('a'), rule('b'), rule('c')],
      logger,
    );
    expect(ids(ordered)).toEqual(['a', 'b', 'c']);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('orders a consumer after the producer of its consumed relationship type', () => {
    const logger = mockServices.logger.mock();
    const consumer = contextRule('consumer', { consumedTypes: ['edge-x'] });
    const producer = rule('producer', { relationshipType: 'edge-x' });
    const ordered = orderRulesByGraphDependencies([consumer, producer], logger);
    expect(ids(ordered)).toEqual(['producer', 'consumer']);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('orders a constrained consumer after an unconstrained context rule that produces its type', () => {
    const logger = mockServices.logger.mock();
    // The unconstrained rules depend on every other rule, so the sort stalls
    // immediately — but the consumer's dependency on 'edge-x' is a hard one
    // and must still be honored when the cycle is broken.
    const consumer = contextRule('consumer', { consumedTypes: ['edge-x'] });
    const producerA = contextRule('producer-a', { relationshipType: 'edge-x' });
    const otherB = contextRule('other-b');
    const ordered = orderRulesByGraphDependencies(
      [consumer, producerA, otherB],
      logger,
    );
    expect(ids(ordered).indexOf('producer-a')).toBeLessThan(
      ids(ordered).indexOf('consumer'),
    );
  });

  it('keeps original order among mutually dependent unconstrained context rules and warns', () => {
    const logger = mockServices.logger.mock();
    const first = contextRule('first');
    const second = contextRule('second');
    const ordered = orderRulesByGraphDependencies([first, second], logger);
    expect(ids(ordered)).toEqual(['first', 'second']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('sourceContext.relationshipTypes'),
    );
  });

  it('falls back to original order on a hard producer/consumer cycle and warns', () => {
    const logger = mockServices.logger.mock();
    const r1 = contextRule('r1', {
      relationshipType: 'edge-1',
      consumedTypes: ['edge-2'],
    });
    const r2 = contextRule('r2', {
      relationshipType: 'edge-2',
      consumedTypes: ['edge-1'],
    });
    const ordered = orderRulesByGraphDependencies([r1, r2], logger);
    expect(ids(ordered)).toEqual(['r1', 'r2']);
    expect(logger.warn).toHaveBeenCalled();
  });
});
