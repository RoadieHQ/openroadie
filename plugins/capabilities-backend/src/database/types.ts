export interface CapabilityRow {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  current_version: number;
  created_at: Date;
  updated_at: Date;
}

export interface Capability {
  id: string;
  workspaceId: string;
  ownership?: 'org' | 'workspace';
  slug: string;
  name: string;
  description: string;
  instructions: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityVersionRow {
  id: string;
  capability_id: string;
  workspace_id: string;
  slug: string;
  version: number;
  name: string;
  description: string;
  instructions: string;
  created_at: Date;
}

export interface CapabilityVersion {
  id: string;
  capabilityId: string;
  workspaceId: string;
  ownership?: 'org' | 'workspace';
  slug: string;
  version: number;
  name: string;
  description: string;
  instructions: string;
  createdAt: string;
}
