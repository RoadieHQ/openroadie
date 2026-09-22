import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { EditorHeader } from './editor-header';

describe('EditorHeader back navigation', () => {
  it('navigates back in history when available', async () => {
    const user = userEvent.setup();
    window.history.replaceState({ idx: 1 }, '');

    render(
      <MemoryRouter initialEntries={['/previous', '/current']} initialIndex={1}>
        <Routes>
          <Route path="/previous" element={<div>Previous page</div>} />
          <Route
            path="/current"
            element={<EditorHeader title="My Doc" backTo="/fallback" />}
          />
          <Route path="/fallback" element={<div>Fallback page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const backLink = screen.getByRole('link');
    expect(backLink.getAttribute('href')).toBe('/fallback');

    await user.click(backLink);

    expect(await screen.findByText('Previous page')).not.toBeNull();
  });

  it('falls back to backTo when there is no history entry', async () => {
    const user = userEvent.setup();
    window.history.replaceState({ idx: 0 }, '');

    render(
      <MemoryRouter initialEntries={['/current']}>
        <Routes>
          <Route
            path="/current"
            element={<EditorHeader title="My Doc" backTo="/fallback" />}
          />
          <Route path="/fallback" element={<div>Fallback page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('link'));

    expect(await screen.findByText('Fallback page')).not.toBeNull();
  });
});
