import {
  resetWorkspaceScope,
  setWorkspaceScope,
  setWorkspaceStorageTenantScope,
} from '../../api/workspace-scope';
import { workspaceEditorDraftKey } from './use-editor-draft';

describe('workspaceEditorDraftKey', () => {
  afterEach(() => {
    resetWorkspaceScope();
    setWorkspaceStorageTenantScope(undefined);
  });

  it('keeps legacy organization drafts and isolates non-default workspaces', () => {
    expect(workspaceEditorDraftKey('actions', 'new')).toBe(
      'actions:editor-draft:new',
    );

    setWorkspaceScope({
      workspaceId: '22222222-2222-4222-8222-222222222222',
      kind: 'personal',
    });
    expect(workspaceEditorDraftKey('actions', 'new')).toBe(
      'actions:editor-draft:22222222-2222-4222-8222-222222222222:new',
    );

    setWorkspaceScope({
      workspaceId: '33333333-3333-4333-8333-333333333333',
      kind: 'personal',
    });
    expect(workspaceEditorDraftKey('actions', 'new')).toBe(
      'actions:editor-draft:33333333-3333-4333-8333-333333333333:new',
    );
  });

  it('keeps default-workspace drafts inside their tenant', () => {
    setWorkspaceStorageTenantScope('tenant-a');
    expect(workspaceEditorDraftKey('actions', 'new')).toBe(
      'actions:editor-draft:tenant-a:__organization__:new',
    );

    setWorkspaceStorageTenantScope('tenant-b');
    expect(workspaceEditorDraftKey('actions', 'new')).toBe(
      'actions:editor-draft:tenant-b:__organization__:new',
    );
  });
});
