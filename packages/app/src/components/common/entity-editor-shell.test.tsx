import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import {
  EntityEditorFormBody,
  EntityEditorHeader,
  EntityEditorShell,
} from './entity-editor-shell';

function renderHeader(
  props: Partial<React.ComponentProps<typeof EntityEditorHeader>> = {},
) {
  return render(
    <MemoryRouter>
      <EntityEditorHeader
        section="capabilities"
        title="My Capability"
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('EntityEditorShell', () => {
  it('renders the shared full-page shell classes', () => {
    render(
      <EntityEditorShell data-testid="shell">
        <div>content</div>
      </EntityEditorShell>,
    );
    expect(screen.getByTestId('shell')).toHaveClass(
      'flex',
      'min-h-0',
      'flex-1',
      'w-full',
      'flex-col',
      'bg-background',
    );
  });

  it('renders the shared form body scroll region', () => {
    render(
      <EntityEditorShell>
        <EntityEditorFormBody data-testid="body">fields</EntityEditorFormBody>
      </EntityEditorShell>,
    );
    expect(screen.getByTestId('body')).toHaveClass(
      'max-w-[720px]',
      'overflow-y-auto',
      'px-6',
      'py-6',
    );
  });
});

describe('EntityEditorHeader', () => {
  it('renders breadcrumb and back links to the listing route, the section icon, and a 32px icon well', () => {
    const { container } = renderHeader();
    expect(screen.getByRole('link', { name: 'Capabilities' })).toHaveAttribute(
      'href',
      '/capabilities',
    );
    expect(screen.getAllByRole('link')[0]).toHaveAttribute(
      'href',
      '/capabilities',
    );
    expect(container.querySelector('.lucide-sparkles')).toBeInTheDocument();
    expect(container.querySelector('.size-8.rounded-md')).toBeInTheDocument();
  });

  it.each([
    ['context-groups', 'My Context Group', '.lucide-users'],
    ['actions', 'My Action', '.lucide-zap'],
    ['integrations', 'Integration', '.lucide-blocks'],
  ] as const)(
    'renders the %s section icon when no logo is provided',
    (section, title, iconSelector) => {
      const { container } = render(
        <MemoryRouter>
          <EntityEditorHeader section={section} title={title} />
        </MemoryRouter>,
      );
      expect(container.querySelector(iconSelector)).toBeInTheDocument();
    },
  );

  it('renders an integration logo when logoUrl is provided', () => {
    const { container } = render(
      <MemoryRouter>
        <EntityEditorHeader
          section="integrations"
          title="GitHub"
          logoUrl="https://example.com/logo.png"
        />
      </MemoryRouter>,
    );
    // The logo is decorative (alt=""), so it has no "img" role — query the
    // element directly rather than via getByRole('img').
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://example.com/logo.png',
    );
  });
});
