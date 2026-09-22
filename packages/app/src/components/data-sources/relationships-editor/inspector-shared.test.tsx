import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import {
  DataSourceCard,
  MetadataRow,
  describeMatchStrategy,
  formatTimestamp,
  isMatchStrategy,
} from './inspector-shared';
import type { DataSourceItem } from '../types';

describe('describeMatchStrategy', () => {
  it('returns the description for known strategies', () => {
    expect(describeMatchStrategy('exact')).toContain('match exactly');
    expect(describeMatchStrategy('array_contains')).toContain('element');
    expect(describeMatchStrategy('person_name_alias')).toContain('person');
  });
});

describe('isMatchStrategy', () => {
  it('accepts every value in the canonical list', () => {
    for (const v of [
      'exact',
      'contains',
      'array_contains',
      'regex',
      'person_name_alias',
    ]) {
      expect(isMatchStrategy(v)).toBe(true);
    }
  });

  it('rejects unknown values', () => {
    expect(isMatchStrategy('banana')).toBe(false);
    expect(isMatchStrategy('')).toBe(false);
  });
});

describe('formatTimestamp', () => {
  it('returns null for missing or empty values', () => {
    expect(formatTimestamp(undefined)).toBeNull();
    expect(formatTimestamp(null)).toBeNull();
    expect(formatTimestamp('')).toBeNull();
  });

  it('returns null for invalid date strings', () => {
    expect(formatTimestamp('not-a-date')).toBeNull();
  });

  it('formats valid ISO timestamps', () => {
    const result = formatTimestamp('2026-01-02T03:04:05Z');
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
  });
});

describe('MetadataRow', () => {
  it('renders the label and the children', () => {
    render(<MetadataRow label="Score">0.95</MetadataRow>);
    expect(screen.getByText('Score')).toBeInTheDocument();
    expect(screen.getByText('0.95')).toBeInTheDocument();
  });
});

function makeDataSource(
  overrides: Partial<DataSourceItem> = {},
): DataSourceItem {
  return {
    id: 'ds-1',
    name: 'My data source',
    enabled: true,
    logoUrl: '',
    execution: {
      objectCount: 42,
      lastRunAt: '2026-01-02T03:04:05Z',
    },
    ...overrides,
  } as DataSourceItem;
}

describe('DataSourceCard', () => {
  it('renders name, status, and object count when ds is provided', () => {
    render(
      <MemoryRouter>
        <DataSourceCard ds={makeDataSource()} fallbackId="ds-1" />
      </MemoryRouter>,
    );
    expect(screen.getByText('My data source')).toBeInTheDocument();
    // Enabled + object count appear in a single line, so use a partial matcher.
    expect(screen.getByText(/Enabled/)).toBeInTheDocument();
    expect(screen.getByText(/42 objects/)).toBeInTheDocument();
  });

  it('falls back to the fallback id when ds is undefined', () => {
    render(
      <MemoryRouter>
        <DataSourceCard ds={undefined} fallbackId="missing-id" />
      </MemoryRouter>,
    );
    expect(screen.getByText('missing-id')).toBeInTheDocument();
  });

  it('renders the optional heading when provided', () => {
    render(
      <MemoryRouter>
        <DataSourceCard
          ds={makeDataSource()}
          fallbackId="ds-1"
          heading="Source"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Source')).toBeInTheDocument();
  });

  it('omits the heading element when no heading prop is given', () => {
    render(
      <MemoryRouter>
        <DataSourceCard ds={makeDataSource()} fallbackId="ds-1" />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Source')).not.toBeInTheDocument();
  });
});
