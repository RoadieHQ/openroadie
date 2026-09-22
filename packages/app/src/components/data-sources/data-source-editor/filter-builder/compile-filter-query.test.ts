import jsonata from 'jsonata';
import type { Field, RuleType } from 'react-querybuilder';
import {
  compileFilterQuery,
  normalizeEmptyChecks,
} from './compile-filter-query';
import { deriveFields } from '../derive-fields';

/**
 * Operator × data-type matrix (sc-34595): every rule the builder can express
 * is compiled and then evaluated with the same JSONata engine the backend
 * filter node uses, so these assertions pin the end-to-end semantics of the
 * expressions we ship — not just their text.
 */

const items = [
  {
    name: 'svc-alpha',
    kind: 'Component',
    archived: false,
    stars: 3,
    created: '2025-06-01T00:00:00Z',
    description: 'primary service',
  },
  {
    name: 'svc-beta',
    kind: 'API',
    archived: true,
    stars: 10,
    created: '2026-03-01T00:00:00Z',
    description: null,
  },
  {
    name: 'web-gamma',
    kind: 'Component',
    archived: true,
    stars: 7,
    created: '2026-07-15T00:00:00Z',
    // description intentionally missing
  },
];

async function matchNames(
  rules: RuleType[],
  fields: Field[] = [],
): Promise<string[]> {
  const expression = compileFilterQuery({ combinator: 'and', rules }, fields);
  expect(expression).not.toBe('');
  const compiled = jsonata(expression);
  const matched: string[] = [];
  for (const item of items) {
    if (await compiled.evaluate(item)) {
      matched.push(item.name);
    }
  }
  return matched;
}

const rule = (field: string, operator: string, value: unknown): RuleType => ({
  field,
  operator,
  value,
});

describe('compileFilterQuery', () => {
  it('compiles an empty group to an empty expression', () => {
    expect(compileFilterQuery({ combinator: 'and', rules: [] })).toBe('');
  });

  describe('string operators', () => {
    it('equals', async () => {
      expect(await matchNames([rule('kind', '=', 'Component')])).toEqual([
        'svc-alpha',
        'web-gamma',
      ]);
    });

    it('not equals', async () => {
      expect(await matchNames([rule('kind', '!=', 'Component')])).toEqual([
        'svc-beta',
      ]);
    });

    it('contains', async () => {
      expect(await matchNames([rule('name', 'contains', 'svc')])).toEqual([
        'svc-alpha',
        'svc-beta',
      ]);
    });

    it('not contains', async () => {
      expect(await matchNames([rule('name', 'doesNotContain', 'svc')])).toEqual(
        ['web-gamma'],
      );
    });

    it('begins with', async () => {
      expect(await matchNames([rule('name', 'beginsWith', 'web')])).toEqual([
        'web-gamma',
      ]);
    });

    it('ends with', async () => {
      expect(await matchNames([rule('name', 'endsWith', 'beta')])).toEqual([
        'svc-beta',
      ]);
    });

    it('in', async () => {
      expect(await matchNames([rule('kind', 'in', 'API, Resource')])).toEqual([
        'svc-beta',
      ]);
    });

    it('not in', async () => {
      expect(
        await matchNames([rule('kind', 'notIn', 'API, Resource')]),
      ).toEqual(['svc-alpha', 'web-gamma']);
    });

    it('is empty matches both an explicit null and a missing field', async () => {
      // Plain JSONata `field = null` only matches literal nulls — an absent
      // field evaluates to nothing and never compares equal — so the compiler
      // emits an explicit $exists check alongside the null comparison.
      const expression = compileFilterQuery({
        combinator: 'and',
        rules: [rule('description', 'null', '')],
      });
      expect(expression).toBe(
        '($not($exists(description)) or description = null)',
      );
      expect(await matchNames([rule('description', 'null', '')])).toEqual([
        'svc-beta',
        'web-gamma',
      ]);
    });

    it('is not empty matches only present non-null values', async () => {
      const expression = compileFilterQuery({
        combinator: 'and',
        rules: [rule('description', 'notNull', '')],
      });
      expect(expression).toBe('($exists(description) and description != null)');
      expect(await matchNames([rule('description', 'notNull', '')])).toEqual([
        'svc-alpha',
      ]);
    });

    it('normalizeEmptyChecks collapses the emitted empty checks back to parseable forms', () => {
      const compiled = compileFilterQuery({
        combinator: 'and',
        rules: [
          rule('kind', '=', 'Component'),
          rule('description', 'null', ''),
          rule('owner.login', 'notNull', ''),
        ],
      });
      expect(normalizeEmptyChecks(compiled)).toBe(
        'kind = "Component" and description = null and owner.login != null',
      );
    });
  });

  describe('number operators', () => {
    it('equals coerces the typed string to a number', async () => {
      expect(await matchNames([rule('stars', '=', '10')])).toEqual([
        'svc-beta',
      ]);
    });

    it('not equals', async () => {
      expect(await matchNames([rule('stars', '!=', '10')])).toEqual([
        'svc-alpha',
        'web-gamma',
      ]);
    });

    it('less than', async () => {
      expect(await matchNames([rule('stars', '<', '7')])).toEqual([
        'svc-alpha',
      ]);
    });

    it('less than or equal', async () => {
      expect(await matchNames([rule('stars', '<=', '7')])).toEqual([
        'svc-alpha',
        'web-gamma',
      ]);
    });

    it('greater than', async () => {
      expect(await matchNames([rule('stars', '>', '7')])).toEqual(['svc-beta']);
    });

    it('greater than or equal', async () => {
      expect(await matchNames([rule('stars', '>=', '7')])).toEqual([
        'svc-beta',
        'web-gamma',
      ]);
    });
  });

  describe('boolean operators', () => {
    it('equals with a real boolean value (switch editor)', async () => {
      expect(await matchNames([rule('archived', '=', true)])).toEqual([
        'svc-beta',
        'web-gamma',
      ]);
      expect(await matchNames([rule('archived', '=', false)])).toEqual([
        'svc-alpha',
      ]);
    });

    it('not equals with a real boolean value', async () => {
      expect(await matchNames([rule('archived', '!=', true)])).toEqual([
        'svc-alpha',
      ]);
    });

    it("coerces a typed 'true' on an unknown field to a boolean comparison (sc-34595)", async () => {
      // The video repro: no dry-run sample yet, so the field's type is
      // unknown and the value editor is a text box. Typing "true" must not
      // compile to the never-matching string comparison `archived = "true"`.
      const expression = compileFilterQuery({
        combinator: 'and',
        rules: [rule('archived', '=', 'true')],
      });
      expect(expression).toBe('archived = true');
      expect(await matchNames([rule('archived', '=', 'true')])).toEqual([
        'svc-beta',
        'web-gamma',
      ]);
    });

    it("coerces a typed 'false' on a field the sample derives as boolean", async () => {
      const fields = deriveFields(items);
      expect(
        await matchNames([rule('archived', '=', 'false')], fields),
      ).toEqual(['svc-alpha']);
    });

    it('coerces case-insensitively and ignores surrounding whitespace', async () => {
      expect(await matchNames([rule('archived', '=', ' True ')])).toEqual([
        'svc-beta',
        'web-gamma',
      ]);
    });

    it("keeps 'true' a string comparison when the sample says the field holds strings", async () => {
      const stringItems = Array.from({ length: 12 }, (_, i) => ({
        flag: i === 0 ? 'true' : `value-${i}`,
      }));
      const fields = deriveFields(stringItems);
      const expression = compileFilterQuery(
        { combinator: 'and', rules: [rule('flag', '=', 'true')] },
        fields,
      );
      expect(expression).toBe('flag = "true"');
    });

    it("does not coerce 'true' on non-equality operators", async () => {
      const expression = compileFilterQuery({
        combinator: 'and',
        rules: [rule('name', 'contains', 'true')],
      });
      expect(expression).toBe('$contains(name, "true")');
    });
  });

  describe('date operators', () => {
    it('before', async () => {
      expect(await matchNames([rule('created', '<', '2026-01-01')])).toEqual([
        'svc-alpha',
      ]);
    });

    it('after', async () => {
      expect(await matchNames([rule('created', '>', '2026-01-01')])).toEqual([
        'svc-beta',
        'web-gamma',
      ]);
    });

    it('on or after', async () => {
      expect(
        await matchNames([rule('created', '>=', '2026-03-01T00:00:00Z')]),
      ).toEqual(['svc-beta', 'web-gamma']);
    });
  });

  describe('groups', () => {
    it('combines nested groups across data types', async () => {
      const expression = compileFilterQuery({
        combinator: 'and',
        rules: [
          rule('archived', '=', 'true'),
          {
            combinator: 'or',
            rules: [rule('stars', '>', '8'), rule('name', 'beginsWith', 'web')],
          },
        ],
      });
      const compiled = jsonata(expression);
      const matched: string[] = [];
      for (const item of items) {
        if (await compiled.evaluate(item)) {
          matched.push(item.name);
        }
      }
      expect(matched).toEqual(['svc-beta', 'web-gamma']);
    });
  });
});
