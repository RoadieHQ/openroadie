import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { EditorHeader } from './editor-header';
import { EditorHeaderTitleProvider } from './editor-header-title-context';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('EditorHeader', () => {
  describe('description', () => {
    it('renders the description inline in the fixed-height rail with the overview gutters', () => {
      renderWithRouter(
        <EditorHeader title="My Doc" description="What this page is for." />,
      );
      const subtitle = screen.getByText('What this page is for.');
      expect(subtitle).toBeInTheDocument();
      expect(subtitle.closest('.sticky')).toHaveClass(
        'h-[70px]',
        'py-3',
        'px-4',
        'sm:px-6',
      );
    });

    it('omits the subtitle when no description is given', () => {
      renderWithRouter(<EditorHeader title="My Doc" />);
      expect(
        screen.queryByText('What this page is for.'),
      ).not.toBeInTheDocument();
    });

    it('uses the same editor rail without a visible description', () => {
      renderWithRouter(<EditorHeader title="My Doc" breadcrumb="Docs" />);
      expect(screen.getByText('Docs').closest('.sticky')).toHaveClass(
        'h-[70px]',
        'min-h-[70px]',
        'shrink-0',
        'py-3',
      );
    });

    it('uses leading-tight on the title and centers the title row when a breadcrumb is shown', () => {
      renderWithRouter(
        <EditorHeader
          title="Pod to Change (Prod Diagnosis)"
          breadcrumb="Context Groups"
        />,
      );
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveClass('leading-tight');
      expect(heading.parentElement).toHaveClass('items-center');
    });

    it('uses tighter left padding when a back control is shown', () => {
      renderWithRouter(
        <EditorHeader title="My Doc" description="Subtitle." backTo="/home" />,
      );
      const header = screen.getByText('Subtitle.').closest('.sticky');
      expect(header).toHaveClass('pl-3', 'pr-4', 'sm:pr-6');
      expect(header).not.toHaveClass('px-4', 'sm:px-6');
    });
  });

  describe('breadcrumb trail', () => {
    it('links a single breadcrumb to breadcrumbPath', () => {
      renderWithRouter(
        <EditorHeader
          title="My Doc"
          breadcrumb="Docs"
          breadcrumbPath="/docs"
        />,
      );
      expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute(
        'href',
        '/docs',
      );
    });

    it('renders a multi-level trail in order, each level linked', () => {
      renderWithRouter(
        <EditorHeader
          title="alice@example.com"
          breadcrumb={[
            { label: 'Datastore', to: '/datastore' },
            { label: 'GitHub Repositories', to: '/datastore?ds=1' },
          ]}
        />,
      );

      const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
      const links = within(trail).getAllByRole('link');
      expect(links.map(l => l.textContent)).toEqual([
        'Datastore',
        'GitHub Repositories',
      ]);
      expect(links[1]).toHaveAttribute('href', '/datastore?ds=1');
    });

    // The current page is the h1, so no crumb may claim to be it — a trail that
    // repeated the title would have the page announced twice.
    it('leaves the current page out of the trail', () => {
      renderWithRouter(
        <EditorHeader
          title="alice@example.com"
          breadcrumb={[{ label: 'Datastore', to: '/datastore' }]}
        />,
      );

      const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
      expect(within(trail).queryByText('alice@example.com')).toBeNull();
      expect(trail.querySelector('[aria-current]')).toBeNull();
    });

    it('renders a level without a route as plain text', () => {
      renderWithRouter(
        <EditorHeader
          title="My Doc"
          breadcrumb={[{ label: 'Archived' }, { label: 'Docs', to: '/docs' }]}
        />,
      );

      const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
      expect(within(trail).getByText('Archived').tagName).toBe('SPAN');
      expect(within(trail).getAllByRole('link')).toHaveLength(1);
    });

    it('renders no trail element at all without a breadcrumb', () => {
      renderWithRouter(<EditorHeader title="My Doc" />);
      expect(
        screen.queryByRole('navigation', { name: 'Breadcrumb' }),
      ).toBeNull();
    });
  });

  describe('title adornment', () => {
    // The h1 is the only fully shrinkable item in the row, so a `shrink-0`
    // adornment made it absorb the whole shortfall — a long id chip squeezed
    // the entity name down to a few characters. Adornments yield first, the
    // same way the description already does.
    it('lets the adornment shrink so it cannot crowd out the title', () => {
      renderWithRouter(
        <EditorHeader
          title="backstage-backend-techdocs@sha256-1c39d5279437"
          titleAdornment={<span>ID sha256-1c39d5279437</span>}
        />,
      );

      const adornment = screen.getByText(
        'ID sha256-1c39d5279437',
      ).parentElement;
      expect(adornment).toHaveClass('shrink-[8]', 'min-w-0', 'overflow-hidden');
      expect(adornment).not.toHaveClass('shrink-0');
    });
  });

  describe('manual save', () => {
    it('renders trailing actions after the save button', () => {
      renderWithRouter(
        <EditorHeader
          title="My Doc"
          saveState="manual"
          onSave={vi.fn()}
          actions={<span>Before save</span>}
          trailingActions={<span>After save</span>}
        />,
      );
      const header = screen.getByText('Before save').parentElement;
      expect(header?.textContent).toMatch(/Before save.*Save.*After save/);
    });

    it('fires onSave when the Save button is clicked', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      renderWithRouter(
        <EditorHeader title="My Doc" saveState="manual" onSave={onSave} />,
      );

      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('shows the save icon on the manual save button', () => {
      const { container } = renderWithRouter(
        <EditorHeader title="My Doc" saveState="manual" onSave={vi.fn()} />,
      );
      expect(container.querySelector('.lucide-save')).toBeInTheDocument();
    });

    it('shows the savingLabel and disables the button while saving', () => {
      renderWithRouter(
        <EditorHeader
          title="My Doc"
          saveState="manual"
          saving
          savingLabel="Saving…"
          onSave={vi.fn()}
        />,
      );

      const button = screen.getByRole('button', { name: /Saving/ });
      expect(button).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });
  });

  describe('Unsaved badge', () => {
    it('appears when saveState is manual and isDirty is true', () => {
      renderWithRouter(
        <EditorHeader
          title="My Doc"
          saveState="manual"
          isDirty
          onSave={vi.fn()}
        />,
      );
      expect(screen.getByText('Unsaved')).toBeInTheDocument();
    });

    it('does not appear when not dirty', () => {
      renderWithRouter(
        <EditorHeader title="My Doc" saveState="manual" onSave={vi.fn()} />,
      );
      expect(screen.queryByText('Unsaved')).toBeNull();
    });

    it('does not appear when saveState is not manual', () => {
      renderWithRouter(<EditorHeader title="My Doc" isDirty />);
      expect(screen.queryByText('Unsaved')).toBeNull();
    });
  });

  describe('document title registration', () => {
    it('registers documentTitle ?? title while mounted, re-registers on change, and unregisters on unmount', () => {
      const unregister = vi.fn();
      const register = vi.fn(() => unregister);

      const { rerender, unmount } = render(
        <MemoryRouter>
          <EditorHeaderTitleProvider register={register}>
            <EditorHeader title="My Doc" />
          </EditorHeaderTitleProvider>
        </MemoryRouter>,
      );
      expect(register).toHaveBeenLastCalledWith('My Doc');

      rerender(
        <MemoryRouter>
          <EditorHeaderTitleProvider register={register}>
            <EditorHeader title="My Doc" documentTitle="Edit My Doc" />
          </EditorHeaderTitleProvider>
        </MemoryRouter>,
      );
      expect(unregister).toHaveBeenCalledTimes(1);
      expect(register).toHaveBeenLastCalledWith('Edit My Doc');

      unmount();
      expect(unregister).toHaveBeenCalledTimes(2);
    });

    it('never writes document.title itself, with or without a provider', () => {
      document.title = 'Untouched';
      const { unmount } = renderWithRouter(<EditorHeader title="My Doc" />);
      expect(document.title).toBe('Untouched');
      unmount();
      expect(document.title).toBe('Untouched');
    });
  });

  describe('back navigation', () => {
    it('renders a link to backTo', () => {
      renderWithRouter(<EditorHeader title="My Doc" backTo="/home" />);
      expect(screen.getByRole('link')).toHaveAttribute('href', '/home');
    });

    it('renders no back control when backTo is omitted', () => {
      renderWithRouter(<EditorHeader title="My Doc" />);
      expect(screen.queryByRole('link')).toBeNull();
    });
  });

  describe('editable description', () => {
    it('reveals an input on click and calls onDescriptionChange on Enter', async () => {
      const user = userEvent.setup();
      const onDescriptionChange = vi.fn();
      renderWithRouter(
        <EditorHeader
          title="My Doc"
          description="Old subtitle"
          editableDescription
          onDescriptionChange={onDescriptionChange}
        />,
      );

      await user.click(screen.getByTestId('editable-description-trigger'));
      const input = screen.getByRole('textbox', { name: 'Edit description' });
      await user.type(input, '!');
      await user.keyboard('{Enter}');

      expect(onDescriptionChange).toHaveBeenCalled();
      expect(onDescriptionChange.mock.lastCall?.[0]).toBe('Old subtitle!');
    });

    it('shows the placeholder affordance when empty and editable', () => {
      renderWithRouter(
        <EditorHeader
          title="My Doc"
          description=""
          editableDescription
          onDescriptionChange={vi.fn()}
        />,
      );
      expect(
        screen.getByTestId('editable-description-trigger'),
      ).toHaveTextContent('Add a description…');
    });

    it('caps the description width and reveals the full text in a tooltip', async () => {
      const user = userEvent.setup();
      const longDescription =
        'Topology shape of AWS EC2 Instances: instance + VPC/subnet + tenant/service/cluster tags, and then some more text that will not fit';
      renderWithRouter(
        <EditorHeader
          title="My Doc"
          description={longDescription}
          editableDescription
          onDescriptionChange={vi.fn()}
        />,
      );

      const trigger = screen.getByTestId('editable-description-trigger');
      expect(trigger).toHaveClass('max-w-[90ch]', 'truncate');

      await user.hover(trigger);
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toHaveTextContent(longDescription);
    });

    it('stays a plain subtitle when not editable', () => {
      renderWithRouter(
        <EditorHeader title="My Doc" description="Read only subtitle" />,
      );
      expect(
        screen.queryByTestId('editable-description-trigger'),
      ).not.toBeInTheDocument();
      expect(screen.getByText('Read only subtitle').tagName).toBe('P');
    });
  });

  describe('editable title', () => {
    it('reveals an input on click and calls onTitleChange when typing', async () => {
      const user = userEvent.setup();
      const onTitleChange = vi.fn();
      renderWithRouter(
        <EditorHeader
          title="Original"
          editable
          onTitleChange={onTitleChange}
        />,
      );

      await user.click(
        screen.getByRole('button', { name: 'Edit title: Original' }),
      );
      const input = screen.getByRole('textbox', { name: 'Edit title' });
      await user.type(input, '!');
      await user.keyboard('{Enter}');

      expect(onTitleChange).toHaveBeenCalled();
      expect(onTitleChange.mock.lastCall?.[0]).toContain('!');
    });

    it('keeps the page h1, named by the title, when the title is editable', () => {
      renderWithRouter(
        <EditorHeader title="Original" editable onTitleChange={vi.fn()} />,
      );
      // The accessible name must be the title itself — not the trigger's
      // "Edit title: …" label leaking up via name-from-content.
      const heading = screen.getByRole('heading', {
        level: 1,
        name: 'Original',
      });
      expect(heading).toHaveTextContent('Original');
    });

    it('returns focus to the trigger after committing with Enter', async () => {
      const user = userEvent.setup();
      renderWithRouter(
        <EditorHeader title="Original" editable onTitleChange={vi.fn()} />,
      );

      await user.click(screen.getByTestId('editable-title-trigger'));
      await user.keyboard('{Enter}');

      expect(screen.getByTestId('editable-title-trigger')).toHaveFocus();
    });
  });

  describe('back control', () => {
    it('labels the icon-only back link for assistive tech', () => {
      renderWithRouter(<EditorHeader title="My Doc" backTo="/home" />);
      expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
        'href',
        '/home',
      );
    });
  });
});
