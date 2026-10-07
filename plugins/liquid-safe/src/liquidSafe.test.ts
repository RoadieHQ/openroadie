/*
 * Copyright 2026 Larder Software Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { describe, it, expect, vi } from 'vitest';
import { Liquid } from 'liquidjs';
import {
  renderLiquidSafe,
  validateLiquidTemplate,
  LiquidBudgetExceededError,
} from './liquidSafe';
import { ALLOWED_FILTERS, ALLOWED_TAGS } from './allowlist';

const PERSON_CONTEXT = {
  group: { id: 'g-1', name: 'Brian Fletcher' },
  members: {
    github: [
      { name: 'Brian Fletcher', email: 'brian@example.com', login: 'punkle' },
    ],
    shortcut: [{ profile: { full_name: 'B. Fletcher' } }],
    pagerduty: [],
  },
};

describe('renderLiquidSafe', () => {
  it('renders variables, loops, and conditionals against a group document', async () => {
    const template = [
      '# {{ group.name }}',
      '{% for m in members.github %}github: {{ m.login }}{% endfor %}',
      '{% if members.pagerduty == empty %}no pagerduty{% endif %}',
    ].join('\n');
    const out = await renderLiquidSafe(template, PERSON_CONTEXT);
    expect(out).toContain('# Brian Fletcher');
    expect(out).toContain('github: punkle');
    expect(out).toContain('no pagerduty');
  });

  it('supports fallback chains via the default filter', async () => {
    const out = await renderLiquidSafe(
      '{{ members.pagerduty[0].name | default: members.shortcut[0].profile.full_name }}',
      PERSON_CONTEXT,
    );
    expect(out).toBe('B. Fletcher');
  });

  it('dumps subtrees as JSON via the json filter', async () => {
    const out = await renderLiquidSafe(
      '{{ members.github[0] | json: 2 }}',
      PERSON_CONTEXT,
    );
    expect(JSON.parse(out)).toEqual(PERSON_CONTEXT.members.github[0]);
  });

  it('indents json continuation lines by the base-indent argument', async () => {
    const out = await renderLiquidSafe(
      '      "data": {{ members.shortcut[0] | json: 2, 6 }}',
      PERSON_CONTEXT,
    );
    expect(out).toBe(
      [
        '      "data": {',
        '        "profile": {',
        '          "full_name": "B. Fletcher"',
        '        }',
        '      }',
      ].join('\n'),
    );
  });

  it('leaves json output untouched without a base indent', async () => {
    const out = await renderLiquidSafe(
      '{{ members.shortcut[0] | json: 2 }}',
      PERSON_CONTEXT,
    );
    expect(out).toBe(
      '{\n  "profile": {\n    "full_name": "B. Fletcher"\n  }\n}',
    );
  });

  it('renders json of a missing value as empty even with a base indent', async () => {
    const out = await renderLiquidSafe(
      '[{{ members.jira[0] | json: 2, 6 }}]',
      PERSON_CONTEXT,
    );
    expect(out).toBe('[]');
  });

  it('renders missing variables as empty instead of throwing', async () => {
    const out = await renderLiquidSafe(
      '[{{ members.jira[0].name }}]',
      PERSON_CONTEXT,
    );
    expect(out).toBe('[]');
  });

  it('does not expose inherited properties or prototype internals', async () => {
    const out = await renderLiquidSafe(
      '[{{ group.constructor }}][{{ group.__proto__ }}]',
      PERSON_CONTEXT,
    );
    expect(out).toBe('[][]');
  });

  describe('data functions', () => {
    it('exposes async data functions as filters', async () => {
      const related = vi.fn(async (_obj: unknown, type: unknown) => [
        { kind: 'pull-request', type },
        { kind: 'pull-request', type },
      ]);
      const out = await renderLiquidSafe(
        "pull-request-count: {{ members.github[0] | related: 'owns' | size }}",
        PERSON_CONTEXT,
        { data: { related } },
      );
      expect(out).toBe('pull-request-count: 2');
      expect(related).toHaveBeenCalledWith(
        PERSON_CONTEXT.members.github[0],
        'owns',
      );
    });

    it('memoizes repeated calls with identical arguments', async () => {
      const related = vi.fn(async () => [1, 2, 3]);
      await renderLiquidSafe(
        "{{ members.github[0] | related: 'owns' | size }} / {{ members.github[0] | related: 'owns' | size }}",
        PERSON_CONTEXT,
        { data: { related } },
      );
      expect(related).toHaveBeenCalledTimes(1);
    });

    it('rejects when the data-call budget is exceeded', async () => {
      const object = vi.fn(async (id: unknown) => ({ id }));
      await expect(
        renderLiquidSafe(
          "{{ 'a' | object }}{{ 'b' | object }}{{ 'c' | object }}",
          {},
          { data: { object }, budget: { maxDataCalls: 2 } },
        ),
      ).rejects.toThrow(LiquidBudgetExceededError);
      expect(object).toHaveBeenCalledTimes(2);
    });

    it('rejects on wall-clock timeout when a data function hangs', async () => {
      const hang = () => new Promise(() => {});
      await expect(
        renderLiquidSafe(
          "{{ 'x' | hang }}",
          {},
          { data: { hang }, budget: { timeoutMs: 100 } },
        ),
      ).rejects.toThrow(/exceeded 100ms/);
    });
  });

  describe('budgets', () => {
    it('rejects template-driven runaway work via the cooperative render limit', async () => {
      // Nested small ranges rather than one huge range: LiquidJS materializes
      // a range into an array before the loop starts, so `(1..100000000)`
      // spent ~1.5s allocating before the render limit could ever fire, and
      // timed out under a loaded full-suite run.
      await expect(
        renderLiquidSafe(
          '{% for i in (1..10000) %}{% for j in (1..10000) %}{{ j }}{% endfor %}{% endfor %}',
          {},
          { budget: { timeoutMs: 100 } },
        ),
      ).rejects.toThrow(/render limit exceeded/);
    });

    it('rejects output larger than the output budget', async () => {
      await expect(
        renderLiquidSafe(
          '{% for i in (1..100) %}0123456789{% endfor %}',
          {},
          { budget: { maxOutputChars: 500 } },
        ),
      ).rejects.toThrow(/output exceeded 500 characters/);
    });
  });

  describe('sandbox', () => {
    it.each(['include', 'render', 'layout'])(
      'rejects the filesystem tag %s',
      async tag => {
        await expect(
          renderLiquidSafe(`{% ${tag} 'other' %}`, {}),
        ).rejects.toThrow(/tag "?\w+"? not found/);
      },
    );

    it('rejects filters outside the allowlist', async () => {
      await expect(
        renderLiquidSafe('{{ group.name | strip_html }}', PERSON_CONTEXT),
      ).rejects.toThrow(/undefined filter: strip_html/);
    });
  });
});

describe('validateLiquidTemplate', () => {
  it('returns no issues for a valid template', () => {
    expect(
      validateLiquidTemplate('# {{ group.name }}{% if a %}b{% endif %}'),
    ).toEqual([]);
  });

  it('reports syntax errors with a position', () => {
    const issues = validateLiquidTemplate('line one\n{% if %}');
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(2);
    expect(issues[0].col).toBeGreaterThan(0);
    expect(issues[0].message).toMatch(/invalid value expression/);
  });

  it('reports disallowed tags at parse time', () => {
    const issues = validateLiquidTemplate("{% include 'other' %}");
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/include/);
  });

  it('reports unknown or disallowed filters at parse time', () => {
    expect(validateLiquidTemplate('{{ a | frobnicate }}')).toHaveLength(1);
    expect(validateLiquidTemplate('{{ a | strip_html }}')).toHaveLength(1);
  });

  it('accepts declared data functions and rejects undeclared ones', () => {
    const template = "{{ m | related: 'owns' | size }}";
    expect(validateLiquidTemplate(template, ['related'])).toEqual([]);
    expect(validateLiquidTemplate(template)).toHaveLength(1);
  });

  it('rejects templates over the size cap without parsing them', () => {
    const issues = validateLiquidTemplate('x'.repeat(1_000_001));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/maximum size/);
  });
});

describe('allowlist', () => {
  it('only names tags and filters that exist in the installed LiquidJS', () => {
    const engine = new Liquid();
    for (const tag of ALLOWED_TAGS) {
      expect(engine.tags, `tag ${tag}`).toHaveProperty([tag]);
    }
    for (const filter of ALLOWED_FILTERS) {
      expect(engine.filters, `filter ${filter}`).toHaveProperty([filter]);
    }
  });
});
