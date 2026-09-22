import jsonataSafe from '@roadiehq/jsonata-safe';
import { buildFieldProfiles } from './field-profiling';
import {
  FILTER_FIELD_MAX_DISTINCT,
  enumerateFilterRefinements,
} from './filteredRuleRefinement';

// Same safe evaluator the apply engine uses — proves the persisted filter
// expression actually selects rows against the raw (un-stringified) object.
const evaluate = (expression: string, obj: Record<string, unknown>) =>
  jsonataSafe(expression, {
    allowLambdas: false,
    allowedFunctions: ['lowercase'],
  }).evaluate(obj);

function k8sObject(
  kind: string,
  name: string,
  namespace = 'default',
): Record<string, unknown> {
  return { kind, metadata: { name, namespace } };
}

describe('enumerateFilterRefinements', () => {
  it('finds $.kind = Deployment as a refinement that cleans up $.metadata.name', () => {
    // 5 Deployments (majority => $.kind looksEnumLike) + 3 Services.
    const sourceObjects = [
      k8sObject('Deployment', 'web-app'),
      k8sObject('Deployment', 'api-server'),
      k8sObject('Deployment', 'worker'),
      k8sObject('Deployment', 'cache'),
      k8sObject('Deployment', 'queue'),
      k8sObject('Service', 'web-svc'),
      k8sObject('Service', 'api-svc'),
      k8sObject('Service', 'db-svc'),
    ];
    const sourceProfiles = buildFieldProfiles(sourceObjects);
    expect(sourceProfiles.profilesByField['$.kind'].looksEnumLike).toBe(true);

    const refinements = enumerateFilterRefinements({
      sourceObjects,
      sourceProfiles,
      candidateSourceField: '$.metadata.name',
    });

    const deploymentRefinement = refinements.find(
      r => r.filterField === '$.kind' && r.filterValue === 'Deployment',
    );
    expect(deploymentRefinement).toBeDefined();
    expect(deploymentRefinement?.slicedObjects).toHaveLength(5);
  });

  it('pins the rendered JSONata filter expression string', () => {
    const sourceObjects = [
      k8sObject('Deployment', 'web-app'),
      k8sObject('Deployment', 'api-server'),
      k8sObject('Deployment', 'worker'),
      k8sObject('Deployment', 'cache'),
      k8sObject('Deployment', 'queue'),
      k8sObject('Service', 'web-svc'),
      k8sObject('Service', 'api-svc'),
      k8sObject('Service', 'db-svc'),
    ];
    const sourceProfiles = buildFieldProfiles(sourceObjects);

    const refinements = enumerateFilterRefinements({
      sourceObjects,
      sourceProfiles,
      candidateSourceField: '$.metadata.name',
    });

    const deploymentRefinement = refinements.find(
      r => r.filterField === '$.kind' && r.filterValue === 'Deployment',
    );
    expect(deploymentRefinement?.filterExpression).toBe(
      "$.kind = 'Deployment'",
    );
  });

  it('re-profiles the filtered slice with correct distinct counts', () => {
    const sourceObjects = [
      k8sObject('Deployment', 'web-app'),
      k8sObject('Deployment', 'api-server'),
      k8sObject('Deployment', 'worker'),
      k8sObject('Deployment', 'cache'),
      k8sObject('Deployment', 'queue'),
      k8sObject('Service', 'web-svc'),
      k8sObject('Service', 'api-svc'),
      k8sObject('Service', 'db-svc'),
    ];
    const sourceProfiles = buildFieldProfiles(sourceObjects);

    const refinements = enumerateFilterRefinements({
      sourceObjects,
      sourceProfiles,
      candidateSourceField: '$.metadata.name',
    });

    const deploymentRefinement = refinements.find(
      r => r.filterField === '$.kind' && r.filterValue === 'Deployment',
    );
    expect(
      deploymentRefinement?.slicedProfiles.profilesByField['$.metadata.name']
        .distinctCount,
    ).toBe(5);
    // The sliced profile set is re-built from scratch: $.kind is now constant
    // within the slice, so it drops out as noise rather than surviving as a
    // (still technically enum-like) single-value field.
    expect(
      deploymentRefinement?.slicedProfiles.profilesByField['$.kind']
        .distinctCount,
    ).toBe(1);
  });

  it('excludes a slice whose candidate field falls below 3 distinct values', () => {
    const sourceObjects = [
      k8sObject('Deployment', 'web-app'),
      k8sObject('Deployment', 'api-server'),
      k8sObject('Service', 'web-svc'),
      k8sObject('Service', 'api-svc'),
      k8sObject('Service', 'db-svc'),
      k8sObject('Service', 'cache-svc'),
      k8sObject('Service', 'queue-svc'),
    ];
    const sourceProfiles = buildFieldProfiles(sourceObjects);

    const refinements = enumerateFilterRefinements({
      sourceObjects,
      sourceProfiles,
      candidateSourceField: '$.metadata.name',
    });

    // Only 2 Deployments exist, so the $.kind = 'Deployment' slice has only 2
    // distinct names -- below the 3-distinct-value floor -- and must not
    // appear as a refinement, even though $.kind is enum-like.
    expect(
      refinements.some(
        r => r.filterField === '$.kind' && r.filterValue === 'Deployment',
      ),
    ).toBe(false);
  });

  it('excludes a filter value containing a single quote, while other values in the same field still refine', () => {
    // $.owner is enum-like (60/25/25 split clears the 50% top-share bar);
    // "O'Brien" carries a quote that a JSONata literal can't hold unescaped.
    const owners = [
      ...Array(6).fill("O'Brien"),
      ...Array(3).fill('Smith'),
      ...Array(3).fill('Jones'),
    ];
    const sourceObjects = owners.map((owner, i) => ({
      owner,
      name: `name-${i}`,
    }));
    const sourceProfiles = buildFieldProfiles(sourceObjects);
    expect(sourceProfiles.profilesByField['$.owner'].looksEnumLike).toBe(true);

    const refinements = enumerateFilterRefinements({
      sourceObjects,
      sourceProfiles,
      candidateSourceField: '$.name',
    });

    const ownerFilterValues = refinements
      .filter(r => r.filterField === '$.owner')
      .map(r => r.filterValue);

    expect(ownerFilterValues).not.toContain("O'Brien");
    expect(ownerFilterValues).toEqual(['Jones', 'Smith']);
  });

  it('returns zero refinements when the source corpus has no enum-like sibling fields', () => {
    const sourceObjects = [
      { id: 'a1', name: 'web-app' },
      { id: 'b2', name: 'api-server' },
      { id: 'c3', name: 'worker' },
      { id: 'd4', name: 'cache' },
    ];
    const sourceProfiles = buildFieldProfiles(sourceObjects);

    const refinements = enumerateFilterRefinements({
      sourceObjects,
      sourceProfiles,
      candidateSourceField: '$.name',
    });

    expect(refinements).toEqual([]);
  });

  it('enumerates refinements in deterministic (filterField, filterValue) sorted order', () => {
    // Two enum-like sibling fields ($.kind, $.metadata.namespace), each with
    // multiple values, so ordering across both fields and values is exercised.
    // Namespace is skewed 4/2/2 so it clears the 50% top-value-share bar.
    const sourceObjects = [
      k8sObject('Deployment', 'web-app-1', 'alpha'),
      k8sObject('Deployment', 'web-app-2', 'alpha'),
      k8sObject('Deployment', 'web-app-3', 'alpha'),
      k8sObject('Deployment', 'web-app-4', 'alpha'),
      k8sObject('Deployment', 'web-app-5', 'beta'),
      k8sObject('Service', 'web-svc-1', 'beta'),
      k8sObject('Service', 'web-svc-2', 'gamma'),
      k8sObject('Service', 'web-svc-3', 'gamma'),
    ];
    const sourceProfiles = buildFieldProfiles(sourceObjects);
    expect(sourceProfiles.profilesByField['$.kind'].looksEnumLike).toBe(true);
    expect(
      sourceProfiles.profilesByField['$.metadata.namespace'].looksEnumLike,
    ).toBe(true);

    const refinements = enumerateFilterRefinements({
      sourceObjects,
      sourceProfiles,
      candidateSourceField: '$.metadata.name',
    });

    expect(refinements.length).toBeGreaterThan(1);
    const pairs = refinements.map(r => [r.filterField, r.filterValue] as const);
    const sortedPairs = [...pairs].sort(([fieldA, valueA], [fieldB, valueB]) =>
      fieldA === fieldB
        ? valueA.localeCompare(valueB)
        : fieldA.localeCompare(fieldB),
    );
    expect(pairs).toEqual(sortedPairs);
  });

  it('caps enumeration at FILTER_FIELD_MAX_DISTINCT values per field and 3 enum fields per candidate', () => {
    expect(FILTER_FIELD_MAX_DISTINCT).toBe(5);

    // Four enum-like sibling fields (60/40 split so each clears the 50%
    // top-value-share bar); only the first 3 by field-path sort ($.a, $.b,
    // $.c) should be considered, never $.d.
    const sourceObjects = Array.from({ length: 10 }, (_, i) => ({
      a: i < 6 ? 'v1' : 'v2',
      b: i < 6 ? 'v1' : 'v2',
      c: i < 6 ? 'v1' : 'v2',
      d: i < 6 ? 'v1' : 'v2',
      name: `name-${i}`,
    }));
    const sourceProfiles = buildFieldProfiles(sourceObjects);
    for (const field of ['$.a', '$.b', '$.c', '$.d']) {
      expect(sourceProfiles.profilesByField[`${field}`].looksEnumLike).toBe(
        true,
      );
    }

    const refinements = enumerateFilterRefinements({
      sourceObjects,
      sourceProfiles,
      candidateSourceField: '$.name',
    });

    const filterFieldsUsed = new Set(refinements.map(r => r.filterField));
    expect(filterFieldsUsed).toEqual(new Set(['$.a', '$.b', '$.c']));
  });

  it('renders an unquoted numeric literal for an integer enum field, matching at apply time', async () => {
    // 5 objects at tier 1, 3 at tier 2 → $.tier looksEnumLike over integers.
    const sourceObjects = Array.from({ length: 8 }, (_, i) => ({
      tier: i < 5 ? 1 : 2,
      name: `name-${i}`,
    }));
    const sourceProfiles = buildFieldProfiles(sourceObjects);
    expect(sourceProfiles.profilesByField['$.tier'].looksEnumLike).toBe(true);

    const refinements = enumerateFilterRefinements({
      sourceObjects,
      sourceProfiles,
      candidateSourceField: '$.name',
    });

    const tierRefinement = refinements.find(
      r => r.filterField === '$.tier' && r.filterValue === '1',
    );
    expect(tierRefinement).toBeDefined();
    // Unquoted: `$.tier = 1`, not `$.tier = '1'`.
    expect(tierRefinement?.filterExpression).toBe('$.tier = 1');

    // The persisted expression must select the raw-number rows. A quoted '1'
    // (the pre-fix output) would evaluate false against the number 1.
    expect(await evaluate(tierRefinement!.filterExpression, { tier: 1 })).toBe(
      true,
    );
    expect(await evaluate("$.tier = '1'", { tier: 1 })).toBe(false);
  });
});
