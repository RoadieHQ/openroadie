import { describe, expect, it } from 'vitest';
import type {
  IndexConfiguration,
  ObjectPresentationPurpose,
} from '../../../api/datastore/datastore-client';
import type { DataSourceObjectRow } from './use-data-source-objects';
import {
  capitalizeFieldLabel,
  columnHeaderLabelFromKey,
  configuredPresentationFieldName,
  fieldLabelFromExpression,
  firstPresentationFieldName,
  humanizeIndexKey,
  isIndexTableColumn,
  presentationIndex,
  resolvePresentationColumnLabels,
  resolveSubtitleFieldName,
  resolveSubtitleFieldNamesByRow,
  resolveTitleFieldName,
} from './resolve-presentation-field-names';

function index(
  key: string,
  valueExpression: string,
  purpose?: ObjectPresentationPurpose,
): IndexConfiguration {
  return {
    id: `i-${key}`,
    key,
    valueExpression,
    purpose,
    datasourceId: 'ds-1',
  };
}

function row(
  object: unknown,
  {
    presentation,
    indexValues = {},
  }: {
    presentation?: { title?: string; subtitle?: string };
    indexValues?: Record<string, string>;
  } = {},
): DataSourceObjectRow {
  return {
    id: 'row-1',
    datasourceId: 'ds-1',
    objectId: 'obj-1',
    object,
    createdAt: '',
    updatedAt: '',
    presentation,
    indexValues: new Map(Object.entries(indexValues)),
  } as DataSourceObjectRow;
}

describe('isIndexTableColumn', () => {
  it('rejects identifier keys and purposes that already have a column', () => {
    expect(isIndexTableColumn(index('id', 'id'))).toBe(false);
    expect(isIndexTableColumn(index('objectId', 'objectId'))).toBe(false);
    expect(isIndexTableColumn(index('name', 'name', 'title'))).toBe(false);
    expect(isIndexTableColumn(index('email', 'email', 'subtitle'))).toBe(false);
    expect(isIndexTableColumn(index('avatar', 'avatar', 'image'))).toBe(false);
  });

  it('accepts value indexes, with or without an explicit purpose', () => {
    expect(isIndexTableColumn(index('region', 'region'))).toBe(true);
    expect(isIndexTableColumn(index('region', 'region', 'column'))).toBe(true);
  });
});

describe('humanizeIndexKey', () => {
  it.each([
    ['presentation.title', 'title'],
    ['displayName', 'display Name'],
    ['path_with_namespace', 'path with namespace'],
    ['metadata.namespace', 'metadata namespace'],
  ])('%s -> %s', (input, expected) => {
    expect(humanizeIndexKey(input)).toBe(expected);
  });
});

describe('capitalizeFieldLabel', () => {
  it('title-cases each word and collapses whitespace', () => {
    expect(capitalizeFieldLabel('full  name')).toBe('Full Name');
  });

  it('leaves an empty label empty', () => {
    expect(capitalizeFieldLabel('   ')).toBe('');
  });
});

describe('columnHeaderLabelFromKey', () => {
  it('humanizes then capitalizes', () => {
    expect(columnHeaderLabelFromKey('resource_type')).toBe('Resource Type');
  });
});

describe('fieldLabelFromExpression', () => {
  it('labels a path by its leaf segment', () => {
    expect(fieldLabelFromExpression('$.profile.displayName')).toBe(
      'display Name',
    );
  });

  it('joins every branch of a conditional expression', () => {
    expect(fieldLabelFromExpression('name ? name : login')).toBe(
      'name / login',
    );
  });

  it('deduplicates repeated branches', () => {
    expect(fieldLabelFromExpression('name ? name : name')).toBe('name');
  });

  it('gives up on expressions that are neither a path nor a conditional', () => {
    expect(fieldLabelFromExpression('$sum(items.price)')).toBeUndefined();
    expect(fieldLabelFromExpression('')).toBeUndefined();
  });
});

describe('presentationIndex', () => {
  it('finds the index configured for a purpose', () => {
    const indexes = [
      index('a', 'a'),
      index('presentation.title', 'name', 'title'),
    ];
    expect(presentationIndex(indexes, 'title')?.key).toBe('presentation.title');
    expect(presentationIndex(indexes, 'subtitle')).toBeUndefined();
  });
});

describe('resolveTitleFieldName', () => {
  it('names the field the display value came from when nothing is configured', () => {
    expect(resolveTitleFieldName(row({ login: 'octocat' }), [])).toBe('login');
  });

  it('matches object keys case-insensitively', () => {
    expect(resolveTitleFieldName(row({ Display_Name: 'Ada' }), [])).toBe(
      'display name',
    );
  });

  it('ignores blank and non-string values when guessing', () => {
    expect(
      resolveTitleFieldName(row({ name: '   ', title: 'Fallback' }), []),
    ).toBe('title');
    expect(resolveTitleFieldName(row({ name: 42, login: 'octocat' }), [])).toBe(
      'login',
    );
  });

  it('prefers a configured value expression over the candidate list', () => {
    const configured = index('presentation.title', '$.full_name', 'title');
    const subject = row(
      { full_name: 'Ada Lovelace', name: 'ada' },
      {
        presentation: { title: 'Ada Lovelace' },
        indexValues: { 'presentation.title': 'Ada Lovelace' },
      },
    );
    expect(resolveTitleFieldName(subject, [configured])).toBe('full name');
  });

  it('takes the expression leaf even when it only names the role', () => {
    // Unlike configuredPresentationFieldName, this level does not second-guess a
    // role-shaped label — the operator wrote `presentation.title`, so "title" is
    // the answer.
    const configured = index('region', 'presentation.title', 'title');
    const subject = row(
      { unrelated: 'x' },
      {
        presentation: { title: 'anything' },
        indexValues: { region: 'anything' },
      },
    );
    expect(resolveTitleFieldName(subject, [configured])).toBe('title');
  });

  it('falls back to the index key when the expression yields no label', () => {
    const configured = index('region', '$uppercase(code)', 'title');
    const subject = row(
      { unrelated: 'x' },
      {
        presentation: { title: 'anything' },
        indexValues: { region: 'anything' },
      },
    );
    expect(resolveTitleFieldName(subject, [configured])).toBe('region');
  });

  it('returns undefined when no candidate field is present', () => {
    expect(resolveTitleFieldName(row({ region: 'eu' }), [])).toBeUndefined();
    expect(resolveTitleFieldName(row('not an object'), [])).toBeUndefined();
  });
});

describe('resolveSubtitleFieldName', () => {
  it('skips the field already supplying the title', () => {
    // `slug` is a candidate for both roles; the title claims it first, so the
    // subtitle must move on rather than label both columns the same.
    expect(
      resolveSubtitleFieldName(row({ slug: 'ada', role: 'admin' }), []),
    ).toBe('role');
  });

  it('infers from the first secondary field present', () => {
    expect(
      resolveSubtitleFieldName(
        row({ name: 'Ada', email: 'ada@example.com' }),
        [],
      ),
    ).toBe('email');
  });

  it('reads nested candidate paths', () => {
    expect(
      resolveSubtitleFieldName(
        row({ name: 'Ada', state: { name: 'open' } }),
        [],
      ),
    ).toBe('state');
  });

  it('returns undefined when no secondary field is present', () => {
    expect(resolveSubtitleFieldName(row({ name: 'Ada' }), [])).toBeUndefined();
  });
});

describe('firstPresentationFieldName', () => {
  it('skips rows that cannot supply the field', () => {
    const rows = [row({ region: 'eu' }), row({ login: 'octocat' })];
    expect(firstPresentationFieldName(rows, [], 'title')).toBe('login');
  });

  it('returns undefined when no row can supply it', () => {
    expect(firstPresentationFieldName([row({})], [], 'title')).toBeUndefined();
    expect(firstPresentationFieldName([], [], 'subtitle')).toBeUndefined();
  });
});

describe('configuredPresentationFieldName', () => {
  it('returns undefined without a configured index', () => {
    expect(
      configuredPresentationFieldName(undefined, [], [], 'title'),
    ).toBeUndefined();
  });

  it('uses the expression label when it names a real field', () => {
    const configured = index('presentation.title', '$.full_name', 'title');
    expect(
      configuredPresentationFieldName(configured, [], [configured], 'title'),
    ).toBe('full name');
  });

  it('falls through to the rows when the expression only names the role', () => {
    const configured = index('presentation.title', 'title', 'title');
    const rows = [row({ login: 'octocat' })];
    expect(
      configuredPresentationFieldName(configured, rows, [configured], 'title'),
    ).toBe('login');
  });

  it('falls back to the humanized key when the rows say nothing', () => {
    const configured = index('presentation.title', 'title', 'title');
    expect(
      configuredPresentationFieldName(configured, [], [configured], 'title'),
    ).toBe('title');
  });
});

describe('resolvePresentationColumnLabels', () => {
  it('keeps generic role labels in cross-source mode', () => {
    const rows = [row({ login: 'octocat', email: 'octo@example.com' })];
    expect(resolvePresentationColumnLabels(rows, [], true)).toEqual({
      titleLabel: 'Title',
      subtitleLabel: 'Secondary',
    });
  });

  it('capitalizes the inferred field names for a single data source', () => {
    const rows = [row({ full_name: 'Ada Lovelace', role: 'admin' })];
    expect(resolvePresentationColumnLabels(rows, [], false)).toEqual({
      titleLabel: 'Full Name',
      subtitleLabel: 'Role',
    });
  });

  it('falls back to the role names when nothing can be inferred', () => {
    expect(resolvePresentationColumnLabels([row({})], [], false)).toEqual({
      titleLabel: 'Title',
      subtitleLabel: 'Secondary',
    });
  });

  it('prefers a configured value expression', () => {
    const configured = index('presentation.title', '$.login', 'title');
    const rows = [
      row(
        { login: 'octocat', name: 'The Octocat' },
        {
          presentation: { title: 'octocat' },
          indexValues: { 'presentation.title': 'octocat' },
        },
      ),
    ];
    expect(
      resolvePresentationColumnLabels(rows, [configured], false).titleLabel,
    ).toBe('Login');
  });
});

describe('resolveSubtitleFieldNamesByRow', () => {
  it('resolves only rows that render a subtitle', () => {
    const withSubtitle = {
      ...row(
        { name: 'Ada', email: 'ada@example.com' },
        { presentation: { subtitle: 'ada@example.com' } },
      ),
      id: 'with',
    };
    const withoutSubtitle = {
      ...row({ name: 'Grace', email: 'grace@example.com' }),
      id: 'without',
    };

    const names = resolveSubtitleFieldNamesByRow(
      [withSubtitle, withoutSubtitle],
      [],
    );

    expect(names.get('with')).toBe('email');
    // Present as a key so the cell lookup is a hit-with-undefined, not a miss.
    expect(names.has('without')).toBe(true);
    expect(names.get('without')).toBeUndefined();
  });
});
