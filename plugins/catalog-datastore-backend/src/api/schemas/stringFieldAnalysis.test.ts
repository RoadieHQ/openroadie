import { describe, expect, it } from 'vitest';
import {
  buildFieldMatchSuggestions,
  buildFieldProfiles,
  buildTargetProfilesFromObjects,
  buildValueToFieldsMap,
  extractStringValues,
  findPathsForValue,
} from './stringFieldAnalysis';

describe('extractStringValues', () => {
  it('adds person-name handle aliases for cross-source overlap', () => {
    const result: Record<string, Record<string, number>> = {};
    extractStringValues({ profile: { name: 'Alice Anderson' } }, '$', result);
    expect(result['$.profile.name']).toMatchObject({
      'Alice Anderson': 1,
      aanderson: 1,
      aliceanderson: 1,
    });
  });

  it('extracts nested strings and key-value arrays', () => {
    const result: Record<string, Record<string, number>> = {};
    extractStringValues(
      {
        metadata: { name: 'svc-a' },
        labels: [{ Key: 'Tenant', Value: 'bitbucket' }],
      },
      '$',
      result,
    );

    expect(result).toEqual({
      '$.metadata.name': { 'svc-a': 1 },
      '$.labels[Value="bitbucket"].Key': { Tenant: 1 },
      '$.labels[Key="Tenant"].Value': { bitbucket: 1 },
    });
  });

  it('unifies a JSON number and its string form in the same value bucket', () => {
    const result: Record<string, Record<string, number>> = {};
    extractStringValues({ id: 42 }, '$', result);
    extractStringValues({ id: '42' }, '$', result);

    expect(result).toEqual({ '$.id': { '42': 2 } });
  });

  it('never profiles non-integer numbers (measures, not join keys)', () => {
    const result: Record<string, Record<string, number>> = {};
    extractStringValues({ price: 4.5 }, '$', result);

    expect(result).toEqual({});
  });
});

describe('buildValueToFieldsMap', () => {
  it('collects generic candidate values without schema-specific filtering', () => {
    const objects = [
      { alpha: 'A-100', beta: 'red' },
      { alpha: 'A-200', beta: 'blue' },
    ];

    expect(buildValueToFieldsMap(objects)).toEqual({
      'A-100': { '$.alpha': 1 },
      'A-200': { '$.alpha': 1 },
      red: { '$.beta': 1 },
      blue: { '$.beta': 1 },
    });
  });
});

describe('findPathsForValue', () => {
  it('finds nested and repeated paths', () => {
    expect(
      findPathsForValue(
        { alpha: { token: 'A-100' }, aliases: ['A-100'] },
        'A-100',
      ).sort(),
    ).toEqual(['$.aliases', '$.alpha.token']);
  });

  it('matches an integer number leaf against its canonical string target', () => {
    expect(findPathsForValue({ id: 42 }, '42')).toEqual(['$.id']);
  });

  it('does not match a non-integer number leaf', () => {
    expect(findPathsForValue({ price: 4.5 }, '4.5')).toEqual([]);
  });
});

describe('buildFieldProfiles', () => {
  it('marks high-cardinality identifier fields as identifier-like', () => {
    const profiles = buildFieldProfiles([
      { alpha: 'A-100' },
      { alpha: 'A-200' },
      { alpha: 'A-300' },
    ]);

    expect(profiles.profilesByField['$.alpha']).toMatchObject({
      distinctCount: 3,
      isIdentifierLike: true,
      looksEnumLike: false,
    });
  });

  it('marks a high-cardinality integer id field as identifier-like (numeric_id)', () => {
    const profiles = buildFieldProfiles([
      { id: 7001 },
      { id: 8102 },
      { id: 9433 },
    ]);

    expect(profiles.profilesByField['$.id']).toMatchObject({
      distinctCount: 3,
      dominantValueType: 'numeric_id',
      isIdentifierLike: true,
      looksEnumLike: false,
    });
  });

  it('marks low-cardinality repeated fields as enum-like based on stats', () => {
    const profiles = buildFieldProfiles([
      { alpha: 'red' },
      { alpha: 'red' },
      { alpha: 'blue' },
      { alpha: 'red' },
    ]);

    expect(profiles.profilesByField['$.alpha']).toMatchObject({
      looksEnumLike: true,
      isIdentifierLike: false,
    });
  });
});

// Scoring and suppression moved out of the builder entirely (Task 5): gates
// run first (candidateGates.ts, applied in suggestRelationshipsService.ts),
// then signalScoring.ts's Fellegi-Sunter scorer. buildFieldMatchSuggestions
// now only builds CandidateMatch[]. These tests assert match strategy
// precedence, verb inference and the identity/relationship kind split;
// dedupe, the array_contains flip, and band/suppression outcomes are covered
// at the service level in suggestRelationshipsService.test.ts.
describe('buildFieldMatchSuggestions', () => {
  it('links display names to handle-like logins via derived search tokens', () => {
    const sourceObjects = [{ name: 'Alice Anderson' }];
    const targetObjects = { gh: [{ login: 'aanderson' }] };
    const sourceProfiles = buildFieldProfiles(sourceObjects);
    expect(sourceProfiles.valueToFields.aanderson).toMatchObject({
      '$.name': 1,
    });

    const suggestions = buildFieldMatchSuggestions(
      sourceProfiles.valueToFields,
      [
        {
          val: 'aanderson',
          datasourceId: 'gh',
          objectId: '1',
          object: { login: 'aanderson' },
        },
      ],
      sourceProfiles.profilesByField,
      buildTargetProfilesFromObjects(targetObjects),
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      sourceField: '$.name',
      targetField: '$.login',
      matchStrategy: 'person_name_alias',
    });
  });

  it('derives suggestionKind "identity" from shape alone, without field-name hints', () => {
    const sourceObjects = [
      { alpha: 'owner-100' },
      { alpha: 'owner-200' },
      { alpha: 'owner-300' },
      { alpha: 'owner-400' },
    ];
    const targetObjects = {
      target: [
        { beta: 'owner-100' },
        { beta: 'owner-200' },
        { beta: 'owner-300' },
        { beta: 'owner-400' },
      ],
    };
    const sourceProfiles = buildFieldProfiles(sourceObjects);

    const suggestions = buildFieldMatchSuggestions(
      sourceProfiles.valueToFields,
      [
        {
          val: 'owner-100',
          datasourceId: 'target',
          objectId: '1',
          object: { beta: 'owner-100' },
        },
        {
          val: 'owner-200',
          datasourceId: 'target',
          objectId: '2',
          object: { beta: 'owner-200' },
        },
        {
          val: 'owner-300',
          datasourceId: 'target',
          objectId: '3',
          object: { beta: 'owner-300' },
        },
        {
          val: 'owner-400',
          datasourceId: 'target',
          objectId: '4',
          object: { beta: 'owner-400' },
        },
      ],
      sourceProfiles.profilesByField,
      buildTargetProfilesFromObjects(targetObjects),
    );

    expect(suggestions[0]).toMatchObject({
      sourceField: '$.alpha',
      targetDatasourceId: 'target',
      targetField: '$.beta',
      suggestionKind: 'identity',
    });
  });

  it('keeps prefixed identifiers and numeric-like references based on uniqueness', () => {
    const sourceObjects = [
      { alpha: 'EXT-1001', beta: '2026001' },
      { alpha: 'EXT-1002', beta: '2026002' },
      { alpha: 'EXT-1003', beta: '2026003' },
    ];
    const targetObjects = {
      target: [
        { gamma: 'EXT-1001', delta: '2026001' },
        { gamma: 'EXT-1002', delta: '2026002' },
        { gamma: 'EXT-1003', delta: '2026003' },
      ],
    };
    const sourceProfiles = buildFieldProfiles(sourceObjects);

    const suggestions = buildFieldMatchSuggestions(
      sourceProfiles.valueToFields,
      [
        {
          val: 'EXT-1001',
          datasourceId: 'target',
          objectId: '1',
          object: { gamma: 'EXT-1001', delta: '2026001' },
        },
        {
          val: 'EXT-1002',
          datasourceId: 'target',
          objectId: '2',
          object: { gamma: 'EXT-1002', delta: '2026002' },
        },
        {
          val: 'EXT-1003',
          datasourceId: 'target',
          objectId: '3',
          object: { gamma: 'EXT-1003', delta: '2026003' },
        },
      ],
      sourceProfiles.profilesByField,
      buildTargetProfilesFromObjects(targetObjects),
    );

    expect(suggestions[0]).toMatchObject({
      sourceField: '$.alpha',
      targetField: '$.gamma',
      suggestionKind: 'identity',
    });
  });

  it('does not classify url-like matches as suggestionKind "identity" (dominant type "other")', () => {
    const sourceObjects = [
      { alpha: 'https://example.com/u/1' },
      { alpha: 'https://example.com/u/2' },
      { alpha: 'https://example.com/u/3' },
    ];
    const targetObjects = {
      target: [
        { beta: 'https://example.com/u/1' },
        { beta: 'https://example.com/u/2' },
        { beta: 'https://example.com/u/3' },
      ],
    };
    const sourceProfiles = buildFieldProfiles(sourceObjects);

    const suggestions = buildFieldMatchSuggestions(
      sourceProfiles.valueToFields,
      [
        {
          val: 'https://example.com/u/1',
          datasourceId: 'target',
          objectId: '1',
          object: { beta: 'https://example.com/u/1' },
        },
        {
          val: 'https://example.com/u/2',
          datasourceId: 'target',
          objectId: '2',
          object: { beta: 'https://example.com/u/2' },
        },
        {
          val: 'https://example.com/u/3',
          datasourceId: 'target',
          objectId: '3',
          object: { beta: 'https://example.com/u/3' },
        },
      ],
      sourceProfiles.profilesByField,
      buildTargetProfilesFromObjects(targetObjects),
    );

    expect(suggestions[0]).toMatchObject({
      sourceField: '$.alpha',
      targetField: '$.beta',
      suggestionKind: 'relationship',
    });
  });

  it('lands a sparse single-identifier cross-source match as suggestionKind "identity"', () => {
    // carolcooper-style: one handle on the source, one handle on the target,
    // both fields identifier-like with high cardinality.
    const sourceObjects = [
      { handle: 'alpha' },
      { handle: 'bravo' },
      { handle: 'charlie' },
      { handle: 'delta' },
      { handle: 'carolcooper' },
    ];
    const targetObjects = {
      target: [
        { login: 'echo' },
        { login: 'foxtrot' },
        { login: 'golf' },
        { login: 'hotel' },
        { login: 'carolcooper' },
      ],
    };
    const sourceProfiles = buildFieldProfiles(sourceObjects);

    const suggestions = buildFieldMatchSuggestions(
      sourceProfiles.valueToFields,
      [
        {
          val: 'carolcooper',
          datasourceId: 'target',
          objectId: '5',
          object: { login: 'carolcooper' },
        },
      ],
      sourceProfiles.profilesByField,
      buildTargetProfilesFromObjects(targetObjects),
    );

    expect(suggestions[0]).toMatchObject({
      sourceField: '$.handle',
      targetField: '$.login',
      suggestionKind: 'identity',
    });
  });

  it('keeps mixed-case handle identifiers across schemas', () => {
    const sourceObjects = [
      { handle: 'JaneDoe' },
      { handle: 'JohnSmith' },
      { handle: 'Alice_Baker' },
      { handle: 'BobCarter' },
    ];
    const targetObjects = {
      target: [
        { login: 'JaneDoe' },
        { login: 'JohnSmith' },
        { login: 'Alice_Baker' },
        { login: 'BobCarter' },
      ],
    };
    const sourceProfiles = buildFieldProfiles(sourceObjects);

    const suggestions = buildFieldMatchSuggestions(
      sourceProfiles.valueToFields,
      [
        {
          val: 'JaneDoe',
          datasourceId: 'target',
          objectId: '1',
          object: { login: 'JaneDoe' },
        },
        {
          val: 'JohnSmith',
          datasourceId: 'target',
          objectId: '2',
          object: { login: 'JohnSmith' },
        },
        {
          val: 'Alice_Baker',
          datasourceId: 'target',
          objectId: '3',
          object: { login: 'Alice_Baker' },
        },
        {
          val: 'BobCarter',
          datasourceId: 'target',
          objectId: '4',
          object: { login: 'BobCarter' },
        },
      ],
      sourceProfiles.profilesByField,
      buildTargetProfilesFromObjects(targetObjects),
    );

    expect(suggestions[0]).toMatchObject({
      sourceField: '$.handle',
      targetField: '$.login',
      suggestionKind: 'identity',
    });
  });

  it('discovers reference-to-identity (foreign-key) pairings across datasources', () => {
    // GitHub Repos owner.login pointing at GitHub Users login. The source
    // field repeats heavily (many repos owned by the same org or user), but
    // the pairing must still be discovered structurally — whether it's worth
    // surfacing is now the gates + FS scorer's job (suggestRelationshipsService.test.ts).
    const sourceObjects = [
      { owner: { login: 'acmecorp' } },
      { owner: { login: 'acmecorp' } },
      { owner: { login: 'acmecorp' } },
      { owner: { login: 'acmecorp' } },
      { owner: { login: 'alice' } },
      { owner: { login: 'alice' } },
      { owner: { login: 'bob' } },
    ];
    const targetObjects = {
      target: [
        { login: 'acmecorp' },
        { login: 'alice' },
        { login: 'bob' },
        { login: 'carol' },
        { login: 'dave' },
        { login: 'eve' },
      ],
    };
    const sourceProfiles = buildFieldProfiles(sourceObjects);

    const suggestions = buildFieldMatchSuggestions(
      sourceProfiles.valueToFields,
      [
        {
          val: 'acmecorp',
          datasourceId: 'target',
          objectId: '0',
          object: { login: 'acmecorp' },
        },
        {
          val: 'alice',
          datasourceId: 'target',
          objectId: '1',
          object: { login: 'alice' },
        },
        {
          val: 'bob',
          datasourceId: 'target',
          objectId: '2',
          object: { login: 'bob' },
        },
      ],
      sourceProfiles.profilesByField,
      buildTargetProfilesFromObjects(targetObjects),
    );

    const ownerToLogin = suggestions.find(
      s => s.sourceField === '$.owner.login' && s.targetField === '$.login',
    );
    expect(ownerToLogin).toBeDefined();
  });

  it('extracts and matches nested key-value array paths', () => {
    const sourceObjects = [
      { properties: { Tags: [{ Key: 'Cluster', Value: 'prod0' }] } },
      { properties: { Tags: [{ Key: 'Cluster', Value: 'prod0' }] } },
      { properties: { Tags: [{ Key: 'Cluster', Value: 'prod0' }] } },
      { properties: { Tags: [{ Key: 'Cluster', Value: 'prod0' }] } },
    ];
    const targetObjects = {
      target: [{ cluster_name: 'prod0' }],
    };
    const sourceProfiles = buildFieldProfiles(sourceObjects);

    const suggestions = buildFieldMatchSuggestions(
      sourceProfiles.valueToFields,
      [
        {
          val: 'prod0',
          datasourceId: 'target',
          objectId: 'target-1',
          object: { cluster_name: 'prod0' },
        },
      ],
      sourceProfiles.profilesByField,
      buildTargetProfilesFromObjects(targetObjects),
    );

    const match = suggestions.find(
      s =>
        s.sourceField === '$.properties.Tags[Key="Cluster"].Value' &&
        s.targetField === '$.cluster_name',
    );
    expect(match).toBeDefined();
  });

  it('keeps inviterName → profile.name name-reference pattern with single distinct value', () => {
    // Source `$.inviterName` repeats the same person (Alice Anderson) across
    // many rows. Target `$.profile.name` carries many distinct person_names —
    // a legitimate many-to-one name reference that must resolve to the
    // person_name_alias match strategy.
    const sourceObjects = [
      { inviterName: 'Alice Anderson' },
      { inviterName: 'Alice Anderson' },
      { inviterName: 'Alice Anderson' },
      { inviterName: 'Alice Anderson' },
      { inviterName: 'Alice Anderson' },
    ];
    const targetObjects = {
      target: [
        { profile: { name: 'Alice Anderson' } },
        { profile: { name: 'Alice Smith' } },
        { profile: { name: 'Bob Jones' } },
        { profile: { name: 'Carol Baker' } },
        { profile: { name: 'Dave Wilson' } },
      ],
    };
    const sourceProfiles = buildFieldProfiles(sourceObjects);

    const suggestions = buildFieldMatchSuggestions(
      sourceProfiles.valueToFields,
      [
        {
          val: 'Alice Anderson',
          datasourceId: 'target',
          objectId: '1',
          object: { profile: { name: 'Alice Anderson' } },
        },
      ],
      sourceProfiles.profilesByField,
      buildTargetProfilesFromObjects(targetObjects),
    );

    const match = suggestions.find(
      s =>
        s.sourceField === '$.inviterName' && s.targetField === '$.profile.name',
    );
    expect(match).toBeDefined();
    expect(match!.matchStrategy).toBe('person_name_alias');
  });

  // Tautological id↔id mirror suppression moved to the gate layer
  // (candidateGates.ts, applied in suggestRelationshipsService.ts) — the
  // builder no longer special-cases id fields. See
  // suggestRelationshipsService.test.ts for the service-level equivalent.

  it('proposes contains-strategy when source values are prefixes of target values', () => {
    // Deployments are "backstage-zocdoc-backend"; pods are
    // "backstage-zocdoc-backend-7647f9f96f-zscnk" — pod name starts with
    // deployment name plus a `-`. The prefix collector lives in
    // suggestRelationshipsService; here we exercise the analyzer-side strategy
    // selection by tagging the SearchResult with `containsMatch: true`.
    const sourceObjects = [
      { deployment_name: 'backstage-zocdoc-backend' },
      { deployment_name: 'backstage-airsupport-frontend' },
    ];
    const targetObjects = {
      pods: [
        { pod: 'backstage-zocdoc-backend-7647f9f96f-zscnk' },
        { pod: 'backstage-airsupport-frontend-abcdef0123-xyz12' },
      ],
    };
    const sourceProfiles = buildFieldProfiles(sourceObjects);

    const suggestions = buildFieldMatchSuggestions(
      sourceProfiles.valueToFields,
      sourceObjects.map((object, index) => ({
        val: object.deployment_name,
        datasourceId: 'pods',
        objectId: String(index),
        object: targetObjects.pods.at(index)!,
        targetVal: targetObjects.pods.at(index)!.pod,
        containsMatch: true,
      })),
      sourceProfiles.profilesByField,
      buildTargetProfilesFromObjects(targetObjects),
    );

    const match = suggestions.find(
      s => s.sourceField === '$.deployment_name' && s.targetField === '$.pod',
    );
    expect(match).toBeDefined();
    expect(match!.matchStrategy).toBe('contains');
  });
});
