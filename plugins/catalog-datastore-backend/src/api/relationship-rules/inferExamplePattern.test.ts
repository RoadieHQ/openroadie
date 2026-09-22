import { describe, expect, it } from 'vitest';
import { inferExampleRelationshipPattern } from './inferExamplePattern';

describe('inferExampleRelationshipPattern', () => {
  it('ranks direct shared field matches and suppresses id mirrors', () => {
    const candidates = inferExampleRelationshipPattern({
      sourceObject: {
        id: 'shared-id',
        service: {
          ownerEmail: 'alice@example.com',
          nested: { ownerEmail: 'alice@example.com' },
        },
      },
      targetObject: {
        id: 'shared-id',
        email: 'alice@example.com',
        profile: { email: 'alice@example.com' },
      },
    });

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFieldExpression: '$.service.ownerEmail',
          targetFieldExpression: '$.email',
          matchedValue: 'alice@example.com',
        }),
        expect.objectContaining({
          sourceFieldExpression: '$.service.ownerEmail',
          targetFieldExpression: '$.profile.email',
          matchedValue: 'alice@example.com',
        }),
      ]),
    );
    expect(
      candidates.some(
        c =>
          c.sourceFieldExpression === '$.id' &&
          c.targetFieldExpression === '$.id',
      ),
    ).toBe(false);

    const directIndex = candidates.findIndex(
      c =>
        c.sourceFieldExpression === '$.service.ownerEmail' &&
        c.targetFieldExpression === '$.email',
    );
    const deeperIndex = candidates.findIndex(
      c =>
        c.sourceFieldExpression === '$.service.nested.ownerEmail' &&
        c.targetFieldExpression === '$.profile.email',
    );
    expect(directIndex).toBeGreaterThanOrEqual(0);
    expect(deeperIndex).toBeGreaterThanOrEqual(0);
    expect(directIndex).toBeLessThan(deeperIndex);
  });

  it('ranks a real email reference above a same-valued environment-constant match', () => {
    // Both pairs are structurally identical to localExampleMatchScore (both
    // sides identifier-like, same shallow depth) — only the semantic
    // demotion (region/env classify 'environment') keeps the environment
    // constant from outranking the real ownerEmail<->email reference.
    const candidates = inferExampleRelationshipPattern({
      sourceObject: {
        region: 'eu-west-1',
        service: { ownerEmail: 'alice@example.com' },
      },
      targetObject: {
        region: 'eu-west-1',
        email: 'alice@example.com',
      },
    });

    const emailIndex = candidates.findIndex(
      c =>
        c.sourceFieldExpression === '$.service.ownerEmail' &&
        c.targetFieldExpression === '$.email',
    );
    const regionIndex = candidates.findIndex(
      c =>
        c.sourceFieldExpression === '$.region' &&
        c.targetFieldExpression === '$.region',
    );
    expect(emailIndex).toBeGreaterThanOrEqual(0);
    expect(regionIndex).toBeGreaterThanOrEqual(0);
    expect(emailIndex).toBeLessThan(regionIndex);
  });
});
