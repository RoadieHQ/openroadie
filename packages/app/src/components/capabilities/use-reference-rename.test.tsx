import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@roadiehq/ui/button';
import { TestQueryProvider } from '../../test-utils';
import {
  useReferenceRename,
  type InterceptRenameArgs,
} from './use-reference-rename';

/** Ordered log of every side effect, so ordering can be asserted directly. */
let calls: string[] = [];
let capabilityItems: Array<{ id: string; name: string; instructions: string }>;
const update = vi.fn();
const alertPost = vi.fn();

vi.mock('../../api', () => ({
  useAlert: () => ({ post: alertPost }),
  useCapabilities: () => ({
    list: async () => ({
      items: capabilityItems,
      total: capabilityItems.length,
    }),
    update: (...args: unknown[]) => update(...args),
  }),
}));

beforeEach(() => {
  calls = [];
  update.mockReset();
  alertPost.mockReset();
  update.mockImplementation(async (id: string) => {
    calls.push(`update:${id}`);
  });
  capabilityItems = [
    {
      id: 'cap-1',
      name: 'Triage',
      instructions: 'Read @datasource:old-slug and @datasource:old-slug-extra.',
    },
    {
      id: 'cap-2',
      name: 'Report',
      instructions: 'Also reads @datasource:old-slug.',
    },
  ];
});

/** Drives the hook and reports what `interceptRename` returned. */
function Harness({
  args,
  onIntercept,
}: {
  args: Omit<InterceptRenameArgs, 'commit'> & {
    commit?: InterceptRenameArgs['commit'];
  };
  onIntercept?: (took: boolean) => void;
}) {
  const guard = useReferenceRename();
  return (
    <div>
      <Button
        type="button"
        onClick={() => {
          const took = guard.interceptRename({
            commit: async () => {
              calls.push('commit');
            },
            ...args,
          } as InterceptRenameArgs);
          onIntercept?.(took);
        }}
      >
        rename
      </Button>
      <span data-testid="checking">{String(guard.checking)}</span>
      {guard.dialog}
    </div>
  );
}

function renderHarness(props: Parameters<typeof Harness>[0]) {
  return render(<Harness {...props} />, { wrapper: TestQueryProvider });
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => {
    expect(screen.getByTestId('checking')).toHaveTextContent('false');
  });
  await user.click(screen.getByRole('button', { name: 'rename' }));
  return screen.findByRole('dialog');
}

describe('interceptRename', () => {
  it('declines when the slug is unchanged', async () => {
    const user = userEvent.setup();
    const onIntercept = vi.fn();
    renderHarness({
      args: {
        type: 'datasource',
        fromSlug: 'old-slug',
        toSlug: 'old-slug',
      },
      onIntercept,
    });

    await waitFor(() => {
      expect(screen.getByTestId('checking')).toHaveTextContent('false');
    });
    await user.click(screen.getByRole('button', { name: 'rename' }));

    expect(onIntercept).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('declines when nothing references the old slug', async () => {
    const user = userEvent.setup();
    const onIntercept = vi.fn();
    renderHarness({
      args: {
        type: 'datasource',
        fromSlug: 'unreferenced',
        toSlug: 'new-slug',
      },
      onIntercept,
    });

    await waitFor(() => {
      expect(screen.getByTestId('checking')).toHaveTextContent('false');
    });
    await user.click(screen.getByRole('button', { name: 'rename' }));

    expect(onIntercept).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('takes over and lists the referencing capabilities', async () => {
    const user = userEvent.setup();
    const onIntercept = vi.fn();
    renderHarness({
      args: { type: 'datasource', fromSlug: 'old-slug', toSlug: 'new-slug' },
      onIntercept,
    });

    const dialog = await openDialog(user);

    expect(onIntercept).toHaveBeenCalledWith(true);
    expect(dialog).toHaveTextContent('Triage');
    expect(dialog).toHaveTextContent('Report');
  });
});

describe('rename execution', () => {
  it('commits the rename before any rewrite', async () => {
    // A failed rename must leave references pointing at a slug that still
    // exists, so the rename has to land first.
    const user = userEvent.setup();
    renderHarness({
      args: { type: 'datasource', fromSlug: 'old-slug', toSlug: 'new-slug' },
    });

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => {
      expect(calls).toEqual(['commit', 'update:cap-1', 'update:cap-2']);
    });
  });

  it('rewrites only the exact slug, leaving a longer sibling alone', async () => {
    const user = userEvent.setup();
    renderHarness({
      args: { type: 'datasource', fromSlug: 'old-slug', toSlug: 'new-slug' },
    });

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('cap-1', {
        instructions:
          'Read @datasource:new-slug and @datasource:old-slug-extra.',
      });
    });
  });

  it('issues no rewrites when the checkbox is unchecked', async () => {
    const user = userEvent.setup();
    renderHarness({
      args: { type: 'datasource', fromSlug: 'old-slug', toSlug: 'new-slug' },
    });

    await openDialog(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => {
      expect(calls).toEqual(['commit']);
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('runs onComplete only after the last rewrite', async () => {
    const user = userEvent.setup();
    renderHarness({
      args: {
        type: 'datasource',
        fromSlug: 'old-slug',
        toSlug: 'new-slug',
        onComplete: () => calls.push('complete'),
      },
    });

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => {
      expect(calls).toEqual([
        'commit',
        'update:cap-1',
        'update:cap-2',
        'complete',
      ]);
    });
  });

  it('never rewrites the excluded capability', async () => {
    const user = userEvent.setup();
    renderHarness({
      args: {
        type: 'datasource',
        fromSlug: 'old-slug',
        toSlug: 'new-slug',
        excludeCapabilityId: 'cap-1',
      },
    });

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => {
      expect(calls).toEqual(['commit', 'update:cap-2']);
    });
  });

  it('issues no rewrites and keeps the dialog open when the rename fails', async () => {
    const user = userEvent.setup();
    renderHarness({
      args: {
        type: 'datasource',
        fromSlug: 'old-slug',
        toSlug: 'new-slug',
        commit: async () => {
          calls.push('commit');
          throw new Error('slug already exists');
        },
      },
    });

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => {
      expect(alertPost).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('slug already exists'),
          severity: 'error',
        }),
      );
    });
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('continues past a failed rewrite and names the stragglers', async () => {
    const user = userEvent.setup();
    update.mockImplementation(async (id: string) => {
      calls.push(`update:${id}`);
      if (id === 'cap-1') throw new Error('conflict');
    });
    renderHarness({
      args: { type: 'datasource', fromSlug: 'old-slug', toSlug: 'new-slug' },
    });

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => {
      // cap-2 still gets its rewrite even though cap-1 failed.
      expect(calls).toEqual(['commit', 'update:cap-1', 'update:cap-2']);
    });
    await waitFor(() => {
      expect(alertPost).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Triage'),
          severity: 'error',
        }),
      );
    });
  });
});
