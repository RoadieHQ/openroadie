import {
  render as rtlRender,
  screen,
  within,
  type RenderResult,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@roadiehq/ui/tooltip';
import type { ExecutionLog } from '../../../../api/workflow/workflow-client';
import { LogsPanel } from './logs-panel';

function render(ui: React.ReactElement): RenderResult {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

const SHORT_MESSAGE = 'short ping';
const LONG_MESSAGE = `long message — ${'x'.repeat(150)}`;

function makeLog(
  overrides: Partial<ExecutionLog> & { id: number },
): ExecutionLog {
  return {
    executionId: 'exec-1',
    level: 'info',
    message: SHORT_MESSAGE,
    createdAt: new Date(2026, 0, 1, 12, 0, overrides.id).toISOString(),
    ...overrides,
  };
}

describe('LogsPanel', () => {
  it('renders an expand button only for long messages', () => {
    render(
      <LogsPanel
        logs={[
          makeLog({ id: 1, message: SHORT_MESSAGE }),
          makeLog({ id: 2, message: LONG_MESSAGE }),
        ]}
      />,
    );

    const expandButtons = screen.getAllByRole('button', {
      name: /Expand log message/i,
    });
    expect(expandButtons).toHaveLength(1);
  });

  it('toggles the expand button label and row aria-expanded when clicked', async () => {
    const user = userEvent.setup();
    render(<LogsPanel logs={[makeLog({ id: 1, message: LONG_MESSAGE })]} />);

    const expandButton = screen.getByRole('button', {
      name: 'Expand log message',
    });
    const row = expandButton.closest('tr');
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute('aria-expanded', 'false');

    await user.click(expandButton);

    expect(
      screen.getByRole('button', { name: 'Collapse log message' }),
    ).toBeInTheDocument();
    expect(row).toHaveAttribute('aria-expanded', 'true');
  });

  it('toggles expansion when the row body is clicked outside the controls', async () => {
    const user = userEvent.setup();
    render(<LogsPanel logs={[makeLog({ id: 1, message: LONG_MESSAGE })]} />);

    const row = screen
      .getByRole('button', { name: 'Expand log message' })
      .closest('tr')!;
    const messageCell = within(row).getByText(LONG_MESSAGE).closest('td')!;

    await user.click(messageCell);

    expect(row).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not toggle expansion when clicking with active text selection', async () => {
    const user = userEvent.setup();
    render(<LogsPanel logs={[makeLog({ id: 1, message: LONG_MESSAGE })]} />);

    const row = screen
      .getByRole('button', { name: 'Expand log message' })
      .closest('tr')!;
    const messageCell = within(row).getByText(LONG_MESSAGE).closest('td')!;

    const selectionMock = {
      toString: () => 'some selected text',
    } as unknown as Selection;
    const getSelectionSpy = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue(selectionMock);

    await user.click(messageCell);

    expect(row).toHaveAttribute('aria-expanded', 'false');
    getSelectionSpy.mockRestore();
  });
});
