import { render, screen } from '@testing-library/react';
import { Zap } from 'lucide-react';
import { GhostTablePreview, type GhostRow } from './ghost-table-preview';

const rows: GhostRow[] = [
  [
    { kind: 'icon', icon: Zap },
    {
      kind: 'title',
      text: 'Create a Jira ticket',
      subtext: 'create-jira-ticket',
    },
    { kind: 'badge', text: 'GET+POST' },
    { kind: 'status', text: 'Enabled' },
    { kind: 'text', text: 'just now' },
  ],
  [
    { kind: 'icon', icon: Zap },
    { kind: 'title', text: 'Trigger a deployment' },
    { kind: 'badge', text: 'POST' },
    { kind: 'status', text: 'Enabled' },
    { kind: 'text', text: 'just now' },
  ],
];

function renderPreview() {
  return render(
    <GhostTablePreview
      headers={['Name', 'Steps', 'Status', 'Updated']}
      columns="2.5rem 1fr 6rem 4rem 5rem"
      rows={rows}
    />,
  );
}

describe('GhostTablePreview', () => {
  it('renders headers and the example rows content', () => {
    renderPreview();

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Create a Jira ticket')).toBeInTheDocument();
    expect(screen.getByText('create-jira-ticket')).toBeInTheDocument();
    expect(screen.getByText('GET+POST')).toBeInTheDocument();
    expect(screen.getByText('Trigger a deployment')).toBeInTheDocument();
  });

  it('is a non-interactive illustration hidden from assistive tech', () => {
    const { container } = renderPreview();

    const block = container.firstElementChild as HTMLElement;
    expect(block).toHaveAttribute('aria-hidden', 'true');
    expect(block.className).toContain('pointer-events-none');
    expect(block.className).toContain('select-none');
  });

  it('renders the settled value of a transition cell', () => {
    render(
      <GhostTablePreview
        headers={['Name', 'Sources']}
        columns="1fr 10rem"
        rows={[
          [
            { kind: 'title', text: 'Everything owned by a team' },
            {
              kind: 'transition',
              from: '0 roots · 0 associated',
              to: '2 roots · 14 associated',
            },
          ],
        ]}
      />,
    );

    expect(screen.getByText('2 roots · 14 associated')).toBeInTheDocument();
  });
});
