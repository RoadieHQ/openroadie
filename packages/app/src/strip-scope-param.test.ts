import { afterEach, describe, expect, it } from 'vitest';
import { createBrowserRouter } from 'react-router';
import { stripScopeParam } from './strip-scope-param';

describe('stripScopeParam', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('removes scope before router initialization without losing URL or history state', () => {
    window.history.replaceState(
      { idx: 7, key: 'hosted-entry', usr: { source: 'hosted' } },
      '',
      '/data-sources?scope=acme&foo=bar#objects',
    );

    stripScopeParam();
    const router = createBrowserRouter([{ path: '*', Component: () => null }]);

    expect(router.state.location).toMatchObject({
      pathname: '/data-sources',
      search: '?foo=bar',
      hash: '#objects',
      state: { source: 'hosted' },
    });
    expect(window.history.state.idx).toBe(7);

    router.dispose();
  });

  it('leaves URLs without scope unchanged', () => {
    window.history.replaceState(
      { source: 'direct' },
      '',
      '/relationships?foo=bar',
    );

    stripScopeParam();

    expect(window.location.href).toBe(
      'http://localhost:3000/relationships?foo=bar',
    );
    expect(window.history.state).toEqual({ source: 'direct' });
  });
});
