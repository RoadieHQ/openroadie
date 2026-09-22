import { render, screen } from '@testing-library/react';
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

  it('renders arrays as expandable trees', () => {
    renderPanel({ teams: [{ name: 'Platform' }, { name: 'Security' }] });

    expect(screen.getByText('teams')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeVisible();
  });
});
