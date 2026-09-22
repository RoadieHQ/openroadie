import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RenameReferenceDialog } from './rename-reference-dialog';

function usedBy(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `cap-${i}`,
    name: `Capability ${i}`,
    instructions: '',
  }));
}

function renderDialog(
  overrides?: Partial<Parameters<typeof RenameReferenceDialog>[0]>,
) {
  const props = {
    open: true,
    type: 'action' as const,
    fromSlug: 'old-slug',
    toSlug: 'new-slug',
    usedBy: usedBy(1),
    rewrite: true,
    onRewriteChange: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<RenameReferenceDialog {...props} />);
  return props;
}

describe('RenameReferenceDialog', () => {
  it('names the token that would break', () => {
    renderDialog();
    expect(screen.getByRole('dialog')).toHaveTextContent('@action:old-slug');
  });

  it('checks the rewrite box by default', () => {
    renderDialog();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('reports an unchecked box to the caller', async () => {
    const user = userEvent.setup();
    const { onRewriteChange } = renderDialog();
    await user.click(screen.getByRole('checkbox'));
    expect(onRewriteChange).toHaveBeenCalledWith(false);
  });

  it('truncates a long list of referencing capabilities', () => {
    renderDialog({ usedBy: usedBy(12) });
    expect(screen.getByTestId('rename-reference-warning')).toHaveTextContent(
      '…and 4 more',
    );
  });

  it('warns about stranded token grants for a slug-targetable type', () => {
    renderDialog({ type: 'action' });
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'action:execute:old-slug',
    );
  });

  it('omits the grant warning for data sources, which have no slug-targeted scope', () => {
    renderDialog({ type: 'datasource' });
    expect(screen.getByRole('dialog')).not.toHaveTextContent(
      'Service tokens scoped to',
    );
  });

  it('warns data-source renames about re-keyed context bundle documents', () => {
    renderDialog({ type: 'datasource' });
    expect(screen.getByRole('dialog')).toHaveTextContent("members['old-slug']");
  });
});
