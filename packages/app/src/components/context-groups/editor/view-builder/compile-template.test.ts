import { describe, expect, it } from 'vitest';
import {
  renderLiquidSafe,
  validateLiquidTemplate,
} from '@roadiehq/liquid-safe';
import { compileViewTemplate } from './compile-template';
import { parseViewTemplate } from './parse-template';
import type { ViewSpec } from './types';

const DATA_FUNCTIONS = ['related', 'object'];

const spec = (over: Partial<ViewSpec> = {}): ViewSpec => ({
  version: 1,
  format: 'json',
  sources: [
    {
      key: 'github_users',
      label: 'GitHub Users',
      fields: [{ path: 'login' }, { path: 'profile.name', label: 'name' }],
      related: [],
    },
  ],
  ...over,
});

const document = {
  group: { id: 'g1', name: 'Jussi' },
  rule: { id: 'r1', name: 'Employee', slug: 'employee', description: null },
  members: {
    github_users: [
      {
        datasourceId: 'ds1',
        objectId: 'o1',
        data: { login: 'jussi', profile: { name: 'Jussi H' }, bio: 'hi' },
      },
      {
        datasourceId: 'ds1',
        objectId: 'o2',
        data: { login: 'brian', profile: { name: 'Brian' }, bio: 'yo' },
      },
    ],
    shortcut_users: [
      { datasourceId: 'ds2', objectId: 's1', data: { email: 'a@b.c' } },
    ],
  },
};

const render = (template: string) =>
  renderLiquidSafe(template, document, {
    data: {
      related: (member: unknown, type: unknown) => [
        {
          datasourceId: 'ds3',
          objectId: `${type}-1`,
          data: {
            title: `Repo of ${(member as { objectId: string }).objectId}`,
          },
        },
      ],
      object: () => ({ datasourceId: 'ds3', objectId: 'x', data: {} }),
    },
  });

describe('compileViewTemplate', () => {
  it('compiles to a template the safe engine accepts', () => {
    const template = compileViewTemplate(
      spec({
        sources: [
          {
            key: 'github_users',
            label: 'GitHub Users',
            fields: [{ path: 'login' }],
            related: [{ type: 'owns', fields: [{ path: 'title' }] }],
            limit: 5,
          },
        ],
      }),
    );

    expect(validateLiquidTemplate(template, DATA_FUNCTIONS)).toEqual([]);
  });

  it('renders JSON format to parseable JSON, with the marker invisible', async () => {
    const template = compileViewTemplate(
      spec({
        sources: [
          {
            key: 'github_users',
            label: 'GitHub Users',
            fields: [{ path: 'login' }, { path: 'profile.name' }],
            related: [],
          },
          {
            key: 'shortcut_users',
            label: 'Shortcut Users',
            fields: [{ path: 'email' }],
            related: [],
          },
        ],
      }),
    );

    const rendered = await render(template);

    expect(rendered).not.toContain('roadie:view');
    expect(JSON.parse(rendered)).toEqual({
      github_users: [
        { objectId: 'o1', login: 'jussi', name: 'Jussi H' },
        { objectId: 'o2', login: 'brian', name: 'Brian' },
      ],
      shortcut_users: [{ objectId: 's1', email: 'a@b.c' }],
    });
  });

  it('compiles hyphenated slug keys to bracket access and renders them', async () => {
    const template = compileViewTemplate(
      spec({
        sources: [
          {
            key: 'github-users',
            label: 'GitHub Users',
            fields: [{ path: 'login' }],
            related: [],
          },
        ],
      }),
    );

    expect(template).toContain("{% for member in members['github-users'] %}");
    expect(validateLiquidTemplate(template, DATA_FUNCTIONS)).toEqual([]);

    const rendered = await renderLiquidSafe(
      template,
      {
        ...document,
        members: { 'github-users': document.members.github_users },
      },
      { data: { related: () => [], object: () => null } },
    );
    expect(JSON.parse(rendered)).toEqual({
      'github-users': [
        { objectId: 'o1', login: 'jussi' },
        { objectId: 'o2', login: 'brian' },
      ],
    });
  });

  it('keeps dotted access for identifier-safe keys', () => {
    const template = compileViewTemplate(spec());
    expect(template).toContain('{% for member in members.github_users %}');
  });

  it('emits the whole object when no fields are selected', async () => {
    const template = compileViewTemplate(
      spec({
        sources: [
          {
            key: 'shortcut_users',
            label: 'Shortcut Users',
            fields: [],
            related: [],
          },
        ],
      }),
    );

    expect(JSON.parse(await render(template))).toEqual({
      shortcut_users: [{ objectId: 's1', data: { email: 'a@b.c' } }],
    });
  });

  it('expands related objects through the related data function', async () => {
    const template = compileViewTemplate(
      spec({
        sources: [
          {
            key: 'shortcut_users',
            label: 'Shortcut Users',
            fields: [{ path: 'email' }],
            related: [{ type: 'owns', fields: [{ path: 'title' }] }],
          },
        ],
      }),
    );

    expect(JSON.parse(await render(template))).toEqual({
      shortcut_users: [
        {
          objectId: 's1',
          email: 'a@b.c',
          owns: [{ objectId: 'owns-1', title: 'Repo of s1' }],
        },
      ],
    });
  });

  it('honours a per-source limit', async () => {
    const template = compileViewTemplate(
      spec({
        sources: [
          {
            key: 'github_users',
            label: 'GitHub Users',
            fields: [{ path: 'login' }],
            related: [],
            limit: 1,
          },
        ],
      }),
    );

    expect(JSON.parse(await render(template))).toEqual({
      github_users: [{ objectId: 'o1', login: 'jussi' }],
    });
  });

  it('disambiguates colliding leaf segments into output keys', async () => {
    const template = compileViewTemplate(
      spec({
        sources: [
          {
            key: 'github_users',
            label: 'GitHub Users',
            fields: [{ path: 'profile.name' }, { path: 'login' }],
            related: [],
            limit: 1,
          },
        ],
      }),
    );

    expect(JSON.parse(await render(template))).toEqual({
      github_users: [{ objectId: 'o1', name: 'Jussi H', login: 'jussi' }],
    });
  });

  it('renders markdown format', async () => {
    const template = compileViewTemplate(
      spec({
        format: 'markdown',
        sources: [
          {
            key: 'github_users',
            label: 'GitHub Users',
            fields: [{ path: 'profile.name' }, { path: 'login' }],
            related: [],
          },
        ],
      }),
    );

    const rendered = await render(template);

    expect(validateLiquidTemplate(template, DATA_FUNCTIONS)).toEqual([]);
    expect(rendered).toContain('## GitHub Users');
    expect(rendered).toContain('- **Jussi H**');
    expect(rendered).toContain('- login: jussi');
  });

  it('renders text format', async () => {
    const template = compileViewTemplate(
      spec({
        format: 'text',
        sources: [
          {
            key: 'github_users',
            label: 'GitHub Users',
            fields: [{ path: 'login' }],
            related: [],
          },
        ],
      }),
    );

    const rendered = await render(template);

    expect(validateLiquidTemplate(template, DATA_FUNCTIONS)).toEqual([]);
    expect(rendered).toContain('== GitHub Users ==');
    expect(rendered).toContain('jussi');
  });

  it('renders an empty object for a spec with no sources', async () => {
    expect(
      JSON.parse(await render(compileViewTemplate(spec({ sources: [] })))),
    ).toEqual({});
  });
});

describe('parseViewTemplate', () => {
  it('round-trips every format', () => {
    for (const format of ['json', 'markdown', 'text'] as const) {
      const original = spec({
        format,
        sources: [
          {
            key: 'github_users',
            label: 'GitHub Users',
            fields: [{ path: 'login', label: 'handle' }],
            related: [{ type: 'owns', fields: [{ path: 'title' }], limit: 3 }],
            limit: 10,
          },
        ],
      });
      expect(parseViewTemplate(compileViewTemplate(original))).toEqual(
        original,
      );
    }
  });

  it('round-trips hyphenated slug keys in every format', () => {
    for (const format of ['json', 'markdown', 'text'] as const) {
      const original = spec({
        format,
        sources: [
          {
            key: 'github-users',
            label: 'GitHub Users',
            fields: [{ path: 'login' }],
            related: [{ type: 'owns', fields: [{ path: 'title' }] }],
          },
        ],
      });
      expect(parseViewTemplate(compileViewTemplate(original))).toEqual(
        original,
      );
    }
  });

  it('round-trips a label that would otherwise open a Liquid token', () => {
    const original = spec({
      sources: [
        {
          key: 'github_users',
          label: 'GitHub Users',
          fields: [{ path: 'login', label: '{{ evil %} {% raw %}' }],
          related: [],
        },
      ],
    });
    const template = compileViewTemplate(original);
    const marker = template.slice(0, template.indexOf('{% endcomment %}'));

    expect(marker).not.toContain('{{');
    expect(marker.slice('{% comment %}'.length)).not.toContain('{%');
    expect(validateLiquidTemplate(template, DATA_FUNCTIONS)).toEqual([]);
    expect(parseViewTemplate(template)).toEqual(original);
  });

  it('returns null for a template with no marker', () => {
    expect(parseViewTemplate('{{ members | json: 2 }}')).toBeNull();
    expect(parseViewTemplate('')).toBeNull();
  });

  it('returns null when the body was edited away from the marker', () => {
    const template = compileViewTemplate(spec());
    expect(parseViewTemplate(`${template}\n{{ group.name }}`)).toBeNull();
  });

  it('returns null for a marker that is not a valid spec', () => {
    expect(
      parseViewTemplate(
        '{% comment %}roadie:view:v1 {"version":9}{% endcomment %}\n{}',
      ),
    ).toBeNull();
    expect(
      parseViewTemplate(
        '{% comment %}roadie:view:v1 not-json{% endcomment %}\n{}',
      ),
    ).toBeNull();
  });

  it('parses legacy roadie:projection:v1 markers so existing templates open', () => {
    const original = spec({
      sources: [
        {
          key: 'github_users',
          label: 'GitHub Users',
          fields: [{ path: 'login' }],
          related: [],
        },
      ],
    });
    const modern = compileViewTemplate(original);
    const legacy = modern.replace('roadie:view:v1', 'roadie:projection:v1');
    expect(parseViewTemplate(legacy)).toEqual(original);
    expect(compileViewTemplate(original)).toContain('roadie:view:v1');
  });
});

/**
 * Frozen fixtures for the backend's
 * 20260821120000_context_group_view_slug_document_keys migration, which
 * textually rewrites stored templates from the old underscored document keys
 * to slug keys. The migration's output must be byte-identical to what this
 * compiler emits for the rewritten spec, or parseViewTemplate's recompile
 * check drops the view to advanced mode. Kept in sync with
 * contextGroupViewSlugKeysMigration.test.ts — migrations are frozen
 * snapshots, so the strings are duplicated rather than imported.
 */
describe('slug-keys migration fixtures', () => {
  const migrationSpec = (key: string): ViewSpec => ({
    version: 1,
    format: 'json',
    sources: [
      {
        key,
        label: 'Github Members',
        fields: [{ path: 'login' }],
        related: [],
      },
    ],
  });

  const OLD_TEMPLATE = `{% comment %}roadie:view:v1 {"version":1,"format":"json","sources":[{"key":"github_members","label":"Github Members","fields":[{"path":"login"}],"related":[]}]}{% endcomment %}
{
  "github_members": [
{% for member in members.github_members %}    {
      "objectId": {{ member.objectId | json }},
      "login": {{ member.data.login | json }}
    }{% unless forloop.last %},{% endunless %}
{% endfor %}  ]
}`;

  const MIGRATED_TEMPLATE = `{% comment %}roadie:view:v1 {"version":1,"format":"json","sources":[{"key":"github-members","label":"Github Members","fields":[{"path":"login"}],"related":[]}]}{% endcomment %}
{
  "github-members": [
{% for member in members['github-members'] %}    {
      "objectId": {{ member.objectId | json }},
      "login": {{ member.data.login | json }}
    }{% unless forloop.last %},{% endunless %}
{% endfor %}  ]
}`;

  it('the old fixture is exactly what the builder compiled for an underscored key', () => {
    expect(compileViewTemplate(migrationSpec('github_members'))).toBe(
      OLD_TEMPLATE,
    );
  });

  it('the migrated fixture is byte-identical to compiling the slug-keyed spec', () => {
    expect(compileViewTemplate(migrationSpec('github-members'))).toBe(
      MIGRATED_TEMPLATE,
    );
    expect(parseViewTemplate(MIGRATED_TEMPLATE)).toEqual(
      migrationSpec('github-members'),
    );
  });
});
