import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { History, Copy, Trash2, GitBranch, Network } from 'lucide-react';
import { Badge } from '../badge';
import { Button } from '../button';
import { EditorHeader } from './editor-header';

const meta = {
  title: 'Header/EditorHeader',
  component: EditorHeader,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof EditorHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

const SecondaryActions = () => (
  <>
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label="View history"
    >
      <History className="size-4" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label="Duplicate"
    >
      <Copy className="size-4" />
    </Button>
    <Button variant="ghost" size="icon" className="size-8" aria-label="Delete">
      <Trash2 className="size-4" />
    </Button>
  </>
);

export const ManualEditor: Story = {
  args: {
    title: 'GitHub Pull Requests',
    description: 'Define a reusable, parameterized HTTP operation.',
    icon: <GitBranch className="size-5" />,
    backTo: '/data-sources',
    saveState: 'manual',
    isDirty: true,
    onSave: fn(),
    actions: <SecondaryActions />,
  },
};

export const WithTitleAdornment: Story = {
  args: {
    title: 'Catalog Builder',
    icon: <Network className="size-5" />,
    titleAdornment: <Badge variant="secondary">Draft</Badge>,
    saveState: 'none',
  },
};

/**
 * Pages nested more than one level deep pass a trail. The current page stays
 * the title — the trail is its ancestors only.
 */
export const BreadcrumbTrail: Story = {
  args: {
    title: 'alice@example.com',
    icon: <Network className="size-5" />,
    backTo: '/datastore?ds=ds-1',
    breadcrumb: [
      { label: 'Datastore', to: '/datastore' },
      { label: 'GitHub Repositories', to: '/datastore?ds=ds-1' },
    ],
    titleAdornment: <Badge variant="outlineMuted">user</Badge>,
    actions: <SecondaryActions />,
  },
};

export const EditableTitle: Story = {
  args: {
    title: 'My Workflow',
    icon: <GitBranch className="size-5" />,
    editable: true,
    onTitleChange: fn(),
    breadcrumb: 'Data Sources',
    breadcrumbPath: '/data-sources',
    actions: <SecondaryActions />,
  },
};
