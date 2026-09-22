import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE_ID, workspaceOwnershipFields } from './types';

describe('workspaceOwnershipFields', () => {
  it('marks the default workspace as organization-owned', () => {
    expect(workspaceOwnershipFields(DEFAULT_WORKSPACE_ID)).toEqual({
      workspaceId: DEFAULT_WORKSPACE_ID,
      ownership: 'org',
    });
  });

  it('marks a personal workspace as workspace-owned', () => {
    const workspaceId = '00000000-0000-4000-8000-000000000002';

    expect(workspaceOwnershipFields(workspaceId)).toEqual({
      workspaceId,
      ownership: 'workspace',
    });
  });
});
