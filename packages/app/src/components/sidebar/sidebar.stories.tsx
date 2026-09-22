import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiContext, type ApiClients } from '../../api/context';
import { FeatureFlagClient } from '../../api/feature-flags/feature-flag-client';
import { DEFAULT_WORKSPACE_ID, WorkspacesClient } from '../../api/workspaces';
import { navItems } from '../../config/navigation';
import { WorkspaceProvider } from '../workspaces';
import { Sidebar } from './sidebar';

// Sidebar gates some nav items on feature flags. A real client over a stub
// fetch returning no flags resolves every lookup to its default, so the story
// renders the full nav without reaching the network.
const featureFlags = new FeatureFlagClient('/stub', async () =>
  Response.json({}),
);

// The rail's identity control is the workspace picker, so the story needs a
// workspace list. Same shape as the feature-flag stub: a real client over a
// stub fetch, so nothing reaches the network.
const workspaces = new WorkspacesClient('/stub', async () =>
  Response.json({
    workspaces: [
      {
        id: DEFAULT_WORKSPACE_ID,
        name: 'Roadie',
        slug: 'roadie',
        type: 'organization',
        svg: null,
        ownerUserId: null,
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
      },
    ],
  }),
);

// Only the clients Sidebar reaches for. Declared as a Partial so the single
// assertion below is a legal widening rather than a double cast.
const mockApis: Partial<ApiClients> = {
  auth: {
    getAccessToken: async () => '',
    login: fn(),
    logout: fn(),
  },
  featureFlags,
  workspaces,
};

const navigation = {
  navigate: async () => {},
};

const meta = {
  title: 'Sidebar/Sidebar',
  component: Sidebar,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    Story => (
      <QueryClientProvider client={new QueryClient()}>
        <ApiContext.Provider value={mockApis as ApiClients}>
          <WorkspaceProvider navigation={navigation}>
            <Story />
          </WorkspaceProvider>
        </ApiContext.Provider>
      </QueryClientProvider>
    ),
  ],
  argTypes: {
    roadieUrl: { control: 'text' },
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    navItems,
    roadieUrl: 'https://app.roadie.io',
  },
};

export const WithoutBackLink: Story = {
  args: {
    navItems,
  },
};
