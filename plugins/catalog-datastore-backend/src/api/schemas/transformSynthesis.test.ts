import { describe, expect, it } from 'vitest';
import jsonataSafe from '@roadiehq/jsonata-safe';
import {
  MIN_TRANSFORM_VALUE_LENGTH,
  synthesizeCompositeKey,
  synthesizeTransform,
  TRANSFORM_CONSISTENCY_MIN,
} from './transformSynthesis';

// Same options relationshipApplyEngine.ts's `jsonata` helper uses (see
// evaluationHelpers.ts) — proves a rendered expression is not just correct
// but actually valid for the apply engine's safe evaluator.
const evaluate = (expression: string, obj: Record<string, unknown>) =>
  jsonataSafe(expression, {
    allowLambdas: false,
    allowedFunctions: ['lowercase'],
  }).evaluate(obj);

describe('constants', () => {
  it('pins TRANSFORM_CONSISTENCY_MIN and MIN_TRANSFORM_VALUE_LENGTH', () => {
    expect(TRANSFORM_CONSISTENCY_MIN).toBe(0.85);
    expect(MIN_TRANSFORM_VALUE_LENGTH).toBe(4);
  });
});

describe('synthesizeTransform', () => {
  it('synthesizes case-fold when lowercasing the dependent values lands them in the referenced set', async () => {
    const dependentValueCounts = { FooBar: 1, BAZQUX: 1 };
    const referencedValueSet = new Set(['foobar', 'bazqux']);

    const result = synthesizeTransform({
      dependentValueCounts,
      referencedValueSet,
    });

    expect(result).toBeDefined();
    expect(result!.program.name).toBe('case-fold');
    expect(result!.consistency).toBe(1);
    expect(result!.transformedValueCounts).toEqual({
      foobar: 1,
      bazqux: 1,
    });
    expect(result!.program.apply('FooBar')).toBe('foobar');

    const rendered = result!.program.renderExpression('id');
    expect(rendered).toBe('$lowercase(id)');
    expect(await evaluate(rendered, { id: 'FooBar' })).toBe(
      result!.program.apply('FooBar'),
    );
  });

  it('synthesizes strip-suffix on the -backstage archetype', async () => {
    const dependentValueCounts = {
      'queue-service-backstage': 1,
      'billing-api-backstage': 1,
      'auth-proxy-backstage': 1,
    };
    const referencedValueSet = new Set([
      'queue-service',
      'billing-api',
      'auth-proxy',
    ]);

    const result = synthesizeTransform({
      dependentValueCounts,
      referencedValueSet,
    });

    expect(result).toBeDefined();
    expect(result!.program.name).toBe('strip-suffix:-backstage');
    expect(result!.consistency).toBe(1);
    expect(result!.transformedValueCounts).toEqual({
      'queue-service': 1,
      'billing-api': 1,
      'auth-proxy': 1,
    });

    const rendered = result!.program.renderExpression('id');
    expect(rendered).toBe("$substringBefore(id, '-backstage')");
    expect(await evaluate(rendered, { id: 'queue-service-backstage' })).toBe(
      result!.program.apply('queue-service-backstage'),
    );
  });

  it('synthesizes strip-prefix symmetrically', async () => {
    // Two hyphens per value (not one) so stripping up to only the FIRST
    // delimiter (what before/after-delim would do) differs from stripping
    // the full "svc-prod-" prefix — otherwise after-delim:- would tie it.
    const dependentValueCounts = {
      'svc-prod-queue': 1,
      'svc-prod-billing': 1,
      'svc-prod-auth': 1,
    };
    const referencedValueSet = new Set(['queue', 'billing', 'auth']);

    const result = synthesizeTransform({
      dependentValueCounts,
      referencedValueSet,
    });

    expect(result).toBeDefined();
    expect(result!.program.name).toBe('strip-prefix:svc-prod-');
    expect(result!.consistency).toBe(1);

    const rendered = result!.program.renderExpression('id');
    expect(rendered).toBe("$substringAfter(id, 'svc-prod-')");
    expect(await evaluate(rendered, { id: 'svc-prod-queue' })).toBe(
      result!.program.apply('svc-prod-queue'),
    );
  });

  it('synthesizes before-delim/after-delim, splitting at the FIRST occurrence', async () => {
    // Two colons in each value — the FIRST is the one that must be used, not
    // the last, exactly mirroring JSONata's $substringBefore/After.
    const dependentValueCounts = {
      'alpha:one:x': 1,
      'beta:two:y': 1,
      'gamma:three:z': 1,
    };
    const referencedValueSet = new Set(['alpha', 'beta', 'gamma']);

    const result = synthesizeTransform({
      dependentValueCounts,
      referencedValueSet,
    });

    expect(result).toBeDefined();
    expect(result!.program.name).toBe('before-delim::');
    expect(result!.consistency).toBe(1);
    // Proves first-occurrence semantics: not "one:x" (which would result
    // from splitting on the last colon).
    expect(result!.program.apply('alpha:one:x')).toBe('alpha');

    const rendered = result!.program.renderExpression('id');
    expect(rendered).toBe("$substringBefore(id, ':')");
    expect(await evaluate(rendered, { id: 'alpha:one:x' })).toBe('alpha');

    // after-delim on the same corpus, targeting the remainder.
    const afterResult = synthesizeTransform({
      dependentValueCounts,
      referencedValueSet: new Set(['one:x', 'two:y', 'three:z']),
    });
    expect(afterResult).toBeDefined();
    expect(afterResult!.program.name).toBe('after-delim::');
    const afterRendered = afterResult!.program.renderExpression('id');
    expect(afterRendered).toBe("$substringAfter(id, ':')");
    expect(await evaluate(afterRendered, { id: 'alpha:one:x' })).toBe('one:x');
  });

  it('leaves before-delim/after-delim unchanged (not undefined) when the delimiter is absent, matching raw JSONata', async () => {
    // The synthesized winner here is before-delim:: (all 3 corpus values
    // carry ':' and split cleanly into the referenced set). Its `apply` must
    // still mirror raw $substringBefore on a value OUTSIDE that corpus that
    // has no colon at all: pass through unchanged, not undefined.
    const program = synthesizeTransform({
      dependentValueCounts: { 'alpha:x': 1, 'beta:y': 1, 'gamma:z': 1 },
      referencedValueSet: new Set(['alpha', 'beta', 'gamma']),
    })!.program;
    expect(program.name).toBe('before-delim::');

    expect(program.apply('no-colon-here')).toBe('no-colon-here');
    expect(
      await evaluate(program.renderExpression('id'), { id: 'no-colon-here' }),
    ).toBe('no-colon-here');
  });

  it('composes a rule with a trailing case-fold only when the uncomposed consistency sits in [0.3, threshold)', () => {
    // before-delim(':') alone: {"Foo","Bar","baz","qux","Quux"} vs referenced
    // {"foo","bar","baz","qux","quux"} matches only the 2 already-lowercase
    // entries (0.4) — in the [0.3, 0.85) retry band. Folding lowercases the
    // rest and reaches 1.0.
    const dependentValueCounts = {
      'Foo:1': 1,
      'Bar:2': 1,
      'baz:3': 1,
      'qux:4': 1,
      'Quux:5': 1,
    };
    const referencedValueSet = new Set(['foo', 'bar', 'baz', 'qux', 'quux']);

    const result = synthesizeTransform({
      dependentValueCounts,
      referencedValueSet,
    });

    expect(result).toBeDefined();
    expect(result!.program.name).toBe('before-delim::+fold');
    expect(result!.consistency).toBe(1);
    expect(result!.program.apply('Foo:1')).toBe('foo');
    expect(result!.program.renderExpression('id')).toBe(
      "$lowercase($substringBefore(id, ':'))",
    );
  });

  it('does not compose a fold when the uncomposed consistency is below the retry floor', () => {
    // Only "baz" is already-lowercase-matching (1/4 = 0.25), below the 0.3
    // retry floor — no folded candidate should even be tried, and nothing
    // else in the grammar reaches the threshold either.
    const result = synthesizeTransform({
      dependentValueCounts: {
        'Foo:1': 1,
        'Bar:2': 1,
        'baz:3': 1,
        'Qux:4': 1,
      },
      referencedValueSet: new Set(['foo', 'bar', 'baz', 'qux']),
    });

    expect(result).toBeUndefined();
  });

  it('rejects when no single program is consistent enough (mixed suffixes)', () => {
    const dependentValueCounts = {
      'svc-alpha-prod': 1,
      'svc-beta-prod': 1,
      'svc-gamma-staging': 1,
      'svc-delta-staging': 1,
    };
    const referencedValueSet = new Set([
      'svc-alpha',
      'svc-beta',
      'svc-gamma',
      'svc-delta',
    ]);

    const result = synthesizeTransform({
      dependentValueCounts,
      referencedValueSet,
    });

    expect(result).toBeUndefined();
  });

  it('breaks ties deterministically by (higher consistency, then lexical program name)', () => {
    // before-delim:- -> {"a","d"} and after-delim:_ -> {"c","f"} both hit a
    // perfect 1.0 against the referenced set; 'after-delim:_' sorts before
    // 'before-delim:-' lexically ('a' < 'b').
    const dependentValueCounts = { 'a-b_c': 1, 'd-e_f': 1 };
    const referencedValueSet = new Set(['a', 'd', 'c', 'f']);

    const result = synthesizeTransform({
      dependentValueCounts,
      referencedValueSet,
    });

    expect(result).toBeDefined();
    expect(result!.program.name).toBe('after-delim:_');
    expect(result!.consistency).toBe(1);
  });

  it('excludes values shorter than MIN_TRANSFORM_VALUE_LENGTH from both numerator and denominator', () => {
    // Two hyphens per eligible value so before/after-delim:- (which only
    // strips up to the FIRST hyphen) doesn't tie strip-suffix:-old.
    const dependentValueCounts = {
      'abcd-suffix-old': 1,
      'efgh-widget-old': 1,
      // 2 chars, and a huge count — would swamp consistency (or dodge the
      // strip-suffix candidate selection entirely) if wrongly counted.
      ab: 100,
    };
    const referencedValueSet = new Set(['abcd-suffix', 'efgh-widget']);

    const result = synthesizeTransform({
      dependentValueCounts,
      referencedValueSet,
    });

    expect(result).toBeDefined();
    expect(result!.program.name).toBe('strip-suffix:-old');
    expect(result!.consistency).toBe(1);
    expect(result!.transformedValueCounts).toEqual({
      'abcd-suffix': 1,
      'efgh-widget': 1,
    });
  });

  it('returns undefined when nothing in the grammar applies', () => {
    const result = synthesizeTransform({
      dependentValueCounts: { zzzzzz: 1 },
      referencedValueSet: new Set(['yyyyyy']),
    });

    expect(result).toBeUndefined();
  });

  it('returns undefined for empty input', () => {
    const result = synthesizeTransform({
      dependentValueCounts: {},
      referencedValueSet: new Set(['anything']),
    });

    expect(result).toBeUndefined();
  });

  it('pins the strip-suffix/strip-prefix pass-through asymmetry: apply() misses, but the rendered rule still passes the value through unchanged', async () => {
    const result = synthesizeTransform({
      dependentValueCounts: {
        'queue-service-backstage': 1,
        'billing-api-backstage': 1,
        'auth-proxy-backstage': 1,
      },
      referencedValueSet: new Set([
        'queue-service',
        'billing-api',
        'auth-proxy',
      ]),
    });
    expect(result).toBeDefined();
    expect(result!.program.name).toBe('strip-suffix:-backstage');

    // apply() treats a value without the literal as a miss...
    expect(result!.program.apply('plain-svc')).toBeUndefined();
    expect(result!.transformedValueCounts).not.toHaveProperty('plain-svc');
    // ...but the PERSISTED rule's raw $substringBefore passes it through
    // unchanged — exactly the asymmetry documented on transformedValueCounts.
    expect(
      await evaluate(result!.program.renderExpression('id'), {
        id: 'plain-svc',
      }),
    ).toBe('plain-svc');
  });
});

describe('synthesizeCompositeKey', () => {
  // Per-object field values, mirroring what buildObjectFieldValues threads in.
  const objectRows = (
    rows: Array<Record<string, string[]>>,
  ): Array<Map<string, Set<string>>> =>
    rows.map(
      row =>
        new Map(
          Object.entries(row).map(([field, values]) => [
            field,
            new Set(values),
          ]),
        ),
    );

  it('finds a composite repo:tag key over two sibling fields', async () => {
    const candidateFieldValueCounts = {
      repo: { api: 1, web: 1, worker: 1 },
      tag: { v1: 1, v2: 1, v3: 1 },
    };
    const referencedValueSet = new Set(['api:v1', 'web:v2', 'worker:v3']);

    const result = synthesizeCompositeKey({
      candidateFieldValueCounts,
      objectFieldValues: objectRows([
        { repo: ['api'], tag: ['v1'] },
        { repo: ['web'], tag: ['v2'] },
        { repo: ['worker'], tag: ['v3'] },
      ]),
      referencedValueSet,
    });

    expect(result).toBeDefined();
    expect(result!.fields).toEqual(['repo', 'tag']);
    expect(result!.delimiter).toBe(':');
    expect(result!.consistency).toBe(1);
    expect(result!.transformedValueCounts).toEqual({
      'api:v1': 1,
      'web:v2': 1,
      'worker:v3': 1,
    });

    const rendered = result!.program.renderExpression('unused');
    expect(rendered).toBe("repo & ':' & tag");
    expect(await evaluate(rendered, { repo: 'api', tag: 'v1' })).toBe(
      result!.program.apply('api:v1'),
    );
  });

  it('rejects a pair/delimiter that only partially matches the referenced set', () => {
    const candidateFieldValueCounts = {
      repo: { api: 1, web: 1 },
      tag: { v1: 1, v2: 1 },
    };
    // Only 1 of 4 referenced values splits into a known (repo, tag) pair.
    const referencedValueSet = new Set([
      'api:v1',
      'unknown:val',
      'other:thing',
      'nope:nope',
    ]);

    const result = synthesizeCompositeKey({
      candidateFieldValueCounts,
      objectFieldValues: objectRows([
        { repo: ['api'], tag: ['v1'] },
        { repo: ['web'], tag: ['v2'] },
      ]),
      referencedValueSet,
    });

    expect(result).toBeUndefined();
  });

  it('rejects a delimiter join whose halves never co-occur on the same object', () => {
    // api and v2 each exist (repo has api, tag has v2), but no object holds
    // both — the cartesian check would ratify "api:v2" as a 100%-consistent
    // key that the per-object concatenation never actually produces.
    const candidateFieldValueCounts = {
      repo: { api: 1, web: 1 },
      tag: { v1: 1, v2: 1 },
    };
    const referencedValueSet = new Set(['api:v2']);

    const result = synthesizeCompositeKey({
      candidateFieldValueCounts,
      objectFieldValues: objectRows([
        { repo: ['api'], tag: ['v1'] },
        { repo: ['web'], tag: ['v2'] },
      ]),
      referencedValueSet,
    });

    expect(result).toBeUndefined();
  });

  it('returns undefined with fewer than two candidate fields', () => {
    const result = synthesizeCompositeKey({
      candidateFieldValueCounts: { repo: { api: 1 } },
      objectFieldValues: objectRows([{ repo: ['api'] }]),
      referencedValueSet: new Set(['api:v1']),
    });

    expect(result).toBeUndefined();
  });

  it('tries both directions of a sibling-field pair (ordered, not combinations)', () => {
    // 'name' < 'namespace' lexically, so a naive i < j scan only ever tries
    // (name, namespace) i.e. "api/default" — never the k8s convention
    // "namespace/name" (default/api). Both directions must be tried.
    const candidateFieldValueCounts = {
      name: { api: 1, web: 1 },
      namespace: { default: 1, staging: 1 },
    };
    const referencedValueSet = new Set(['default/api', 'staging/web']);

    const result = synthesizeCompositeKey({
      candidateFieldValueCounts,
      objectFieldValues: objectRows([
        { name: ['api'], namespace: ['default'] },
        { name: ['web'], namespace: ['staging'] },
      ]),
      referencedValueSet,
    });

    expect(result).toBeDefined();
    expect(result!.fields).toEqual(['namespace', 'name']);
    expect(result!.delimiter).toBe('/');
    expect(result!.consistency).toBe(1);
  });

  it('renders a quoted-key path (field-profiling quoteKey output) that evaluates correctly against real jsonata', async () => {
    // Per the documented contract, candidateFieldValueCounts keys must
    // already be standalone JSONata path expressions — a bare hyphenated
    // name like `repo-name` is NOT one (it parses as subtraction). A caller
    // using field-profiling's quoteKey supplies `$.'repo-name'` instead.
    const candidateFieldValueCounts = {
      "$.'repo-name'": { api: 1, web: 1 },
      '$.tag': { v1: 1, v2: 1 },
    };
    const referencedValueSet = new Set(['api:v1', 'web:v2']);

    const result = synthesizeCompositeKey({
      candidateFieldValueCounts,
      objectFieldValues: objectRows([
        { "$.'repo-name'": ['api'], '$.tag': ['v1'] },
        { "$.'repo-name'": ['web'], '$.tag': ['v2'] },
      ]),
      referencedValueSet,
    });

    expect(result).toBeDefined();
    expect(result!.fields).toEqual(["$.'repo-name'", '$.tag']);

    const rendered = result!.program.renderExpression('unused');
    expect(rendered).toBe("$.'repo-name' & ':' & $.tag");
    expect(await evaluate(rendered, { 'repo-name': 'api', tag: 'v1' })).toBe(
      'api:v1',
    );
  });
});

describe('render/apply parity against the real jsonata engine', () => {
  it('validates every synthesized program from the full grammar against real jsonata', async () => {
    const fixtures: Array<{
      dependentValueCounts: Record<string, number>;
      referencedValueSet: Set<string>;
      sampleId: string;
    }> = [
      {
        dependentValueCounts: { FooBar: 1, BAZQUX: 1 },
        referencedValueSet: new Set(['foobar', 'bazqux']),
        sampleId: 'FooBar',
      },
      {
        dependentValueCounts: {
          'queue-service-backstage': 1,
          'billing-api-backstage': 1,
        },
        referencedValueSet: new Set(['queue-service', 'billing-api']),
        sampleId: 'queue-service-backstage',
      },
      {
        // Two hyphens, so the winner is genuinely strip-prefix:svc-prod- and
        // not an after-delim:- that happens to tie it (see the dedicated
        // strip-prefix test for why a single hyphen would be ambiguous).
        dependentValueCounts: {
          'svc-prod-queue': 1,
          'svc-prod-billing': 1,
        },
        referencedValueSet: new Set(['queue', 'billing']),
        sampleId: 'svc-prod-queue',
      },
      {
        dependentValueCounts: { 'alpha:one:x': 1, 'beta:two:y': 1 },
        referencedValueSet: new Set(['alpha', 'beta']),
        sampleId: 'alpha:one:x',
      },
      {
        // Forces the +fold composition path (before-delim:: alone lands at
        // 0.4 consistency; folding reaches 1.0) — see the dedicated +fold
        // test for the full breakdown.
        dependentValueCounts: {
          'Foo:1': 1,
          'Bar:2': 1,
          'baz:3': 1,
          'qux:4': 1,
          'Quux:5': 1,
        },
        referencedValueSet: new Set(['foo', 'bar', 'baz', 'qux', 'quux']),
        sampleId: 'Foo:1',
      },
    ];

    for (const fixture of fixtures) {
      const result = synthesizeTransform({
        dependentValueCounts: fixture.dependentValueCounts,
        referencedValueSet: fixture.referencedValueSet,
      });
      expect(result).toBeDefined();
      const rendered = result!.program.renderExpression('id');
      const evaluated = await evaluate(rendered, { id: fixture.sampleId });
      expect(evaluated).toBe(result!.program.apply(fixture.sampleId));
    }
  });
});
