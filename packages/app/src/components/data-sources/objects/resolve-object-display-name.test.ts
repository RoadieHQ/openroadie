import { describe, expect, it } from 'vitest';
import { resolveObjectDisplayName } from './resolve-object-display-name';

describe('resolveObjectDisplayName', () => {
  it('uses the first non-empty priority field', () => {
    expect(
      resolveObjectDisplayName(
        {
          name: '  ',
          display_name: 'Display Name',
          title: 'Title',
          email: 'person@example.com',
        },
        'object-1',
      ),
    ).toBe('Display Name');
  });

  it('checks nested profile fields after top-level fields', () => {
    expect(
      resolveObjectDisplayName(
        {
          profile: {
            full_name: 'Nested Person',
          },
        },
        'object-2',
      ),
    ).toBe('Nested Person');
  });

  it('falls back to the object id', () => {
    expect(
      resolveObjectDisplayName({ profile: { display_name: '' } }, 'object-3'),
    ).toBe('object-3');
  });
});
