// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  resetWorkspaceScope,
  setWorkspaceScope,
} from '../../../api/workspace-scope';
import { readStoredDatastoreSearch } from './use-persisted-view-param';

describe('persisted datastore view parameters', () => {
  afterEach(() => {
    window.sessionStorage.clear();
    resetWorkspaceScope();
  });

  it('reads search state only from the active workspace', () => {
    window.sessionStorage.setItem(
      'roadie.datastore.search.workspace-a',
      'workspace A search',
    );
    window.sessionStorage.setItem(
      'roadie.datastore.search.workspace-b',
      'workspace B search',
    );

    setWorkspaceScope({ workspaceId: 'workspace-a', kind: 'personal' });
    expect(readStoredDatastoreSearch()).toBe('workspace A search');

    setWorkspaceScope({ workspaceId: 'workspace-b', kind: 'personal' });
    expect(readStoredDatastoreSearch()).toBe('workspace B search');
  });
});
