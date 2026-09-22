import { describe, expect, it } from 'vitest';
import {
  graphUrlStateToParams,
  parseGraphUrlState,
  parseObjectGraphFocus,
} from './graph-url-state';

describe('parseObjectGraphFocus', () => {
  it('splits on the first colon so object ids may contain colons', () => {
    expect(parseObjectGraphFocus('ds-1:repo:main')).toEqual({
      datasourceId: 'ds-1',
      objectId: 'repo:main',
    });
  });

  it('rejects malformed values', () => {
    expect(parseObjectGraphFocus(null)).toBeNull();
    expect(parseObjectGraphFocus('')).toBeNull();
    expect(parseObjectGraphFocus('no-colon')).toBeNull();
    expect(parseObjectGraphFocus(':leading')).toBeNull();
    expect(parseObjectGraphFocus('trailing:')).toBeNull();
  });
});

describe('parseGraphUrlState', () => {
  it('defaults to the object view with empty filters', () => {
    const state = parseGraphUrlState(new URLSearchParams());
    expect(state).toEqual({
      view: 'object',
      ds: [],
      types: [],
      expandGroups: false,
      focus: null,
      depth: 2,
      dir: 'both',
      a: null,
      b: null,
      pathDepth: null,
    });
  });

  it('treats a legacy bare ?focus deep link as the object view', () => {
    const state = parseGraphUrlState(new URLSearchParams('focus=ds-1:obj'));
    expect(state.view).toBe('object');
    expect(state.focus).toEqual({ datasourceId: 'ds-1', objectId: 'obj' });
  });

  it('parses every param', () => {
    const state = parseGraphUrlState(
      new URLSearchParams(
        'view=paths&ds=d1,d2&types=owns,uses&groups=expanded' +
          '&focus=d1:x&depth=3&dir=out&a=d1:s&b=d2:t&pathDepth=6',
      ),
    );
    expect(state).toEqual({
      view: 'paths',
      ds: ['d1', 'd2'],
      types: ['owns', 'uses'],
      expandGroups: true,
      focus: { datasourceId: 'd1', objectId: 'x' },
      depth: 3,
      dir: 'out',
      a: { datasourceId: 'd1', objectId: 's' },
      b: { datasourceId: 'd2', objectId: 't' },
      pathDepth: 6,
    });
  });

  it('treats any other ?groups value as the collapsed default', () => {
    expect(
      parseGraphUrlState(new URLSearchParams('groups=nope')).expandGroups,
    ).toBe(false);
  });

  it('falls back on malformed values, including the retired overview mode', () => {
    const state = parseGraphUrlState(
      new URLSearchParams('view=overview&depth=9&dir=diagonal&pathDepth=99'),
    );
    expect(state.view).toBe('object');
    expect(state.depth).toBe(2);
    expect(state.dir).toBe('both');
    expect(state.pathDepth).toBe(6);
  });
});

describe('graphUrlStateToParams', () => {
  it('round-trips a full state', () => {
    const params = new URLSearchParams(
      'view=paths&ds=d1,d2&types=owns&groups=expanded' +
        '&focus=d1:x&depth=1&dir=in&a=d1:s&b=d2:t&pathDepth=2',
    );
    const state = parseGraphUrlState(params);
    expect(parseGraphUrlState(graphUrlStateToParams(state))).toEqual(state);
  });

  it('omits every default', () => {
    const params = graphUrlStateToParams(
      parseGraphUrlState(new URLSearchParams()),
    );
    expect(params.toString()).toBe('');
  });
});
