import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ObjectMetadataPanel } from './object-metadata-panel';

function renderPanel(object: unknown) {
  return render(<ObjectMetadataPanel object={object} />);
}

describe('ObjectMetadataPanel', () => {
  it('keeps scalar values in compact copy rows', () => {
    renderPanel({ name: 'Ada', active: true });

    expect(screen.getByRole('button', { name: 'Copy name' })).toHaveTextContent(
      'Ada',
    );
    expect(
      screen.getByRole('button', { name: 'Copy active' }),
    ).toHaveTextContent('true');
  });

  it('renders nested objects as expandable trees', () => {
    renderPanel({
      name: 'Ada',
      profile: {
        location: {
          city: 'London',
        },
      },
    });

    expect(screen.getByText('profile')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeVisible();
    expect(screen.getByText('location')).toBeInTheDocument();
  });

  it('renders http(s) values as links that open in a new tab', () => {
    const url = 'https://kildarecoco.ie/minutes/200226%20%20Minutes.pdf';
    renderPanel({ name: 'Meeting', minutesUrl: url });

    const link = screen.getByRole('link', { name: url });
    expect(link).toHaveAttribute('href', url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('keeps a copy control alongside a link', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderPanel({ agendaUrl: 'http://example.com/agenda.pdf' });

    await user.click(screen.getByRole('button', { name: 'Copy agendaUrl' }));

    expect(writeText).toHaveBeenCalledWith('http://example.com/agenda.pdf');
  });

  it('never links non-http values', () => {
    renderPanel({
      name: 'Ada',
      script: 'javascript:alert(1)',
      data: 'data:text/html,<b>x</b>',
      path: '/relative/path',
    });

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders arrays as expandable trees', () => {
    renderPanel({ teams: [{ name: 'Platform' }, { name: 'Security' }] });

    expect(screen.getByText('teams')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeVisible();
  });
});
