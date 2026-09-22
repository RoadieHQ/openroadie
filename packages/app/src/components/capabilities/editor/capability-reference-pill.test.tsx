import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ReactMarkdown from 'react-markdown';
import { makeCapabilityReferenceComponents } from './capability-reference-pill';
import { remarkCapabilityReferences } from './remark-capability-references';
import { referenceKey, type CapabilityReference } from './references';

function renderMarkdown(markdown: string, refs: CapabilityReference[] = []) {
  const byKey = new Map(
    refs.map(ref => [referenceKey(ref.type, ref.slug), ref] as const),
  );
  return render(
    <MemoryRouter>
      <ReactMarkdown
        remarkPlugins={[remarkCapabilityReferences]}
        components={makeCapabilityReferenceComponents(byKey)}
      >
        {markdown}
      </ReactMarkdown>
    </MemoryRouter>,
  );
}

describe('capability reference pills', () => {
  it('renders a resolved reference as a link to its detail page in a new tab', () => {
    renderMarkdown('Run @action:deploy-service now.', [
      {
        type: 'action',
        slug: 'deploy-service',
        name: 'Deploy Service',
        id: 'act-1',
      },
    ]);

    const link = screen.getByRole('link', { name: /Deploy Service/ });
    expect(link).toHaveAttribute('href', '/actions/act-1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    // The preview's generic markdown-link styling is scoped to skip anchors
    // carrying this marker, so the pill keeps its own look instead of the
    // underlined-link treatment.
    expect(link).toHaveAttribute('data-capability-reference', 'true');
  });

  it('links each reference type to its own route', () => {
    renderMarkdown('@datasource:cat @capability:play @context-group:team', [
      { type: 'datasource', slug: 'cat', name: 'Catalog', id: 'ds-1' },
      { type: 'capability', slug: 'play', name: 'Playbook', id: 'cap-1' },
      { type: 'context-group', slug: 'team', name: 'Team', id: 'cg-1' },
    ]);

    expect(screen.getByRole('link', { name: /Catalog/ })).toHaveAttribute(
      'href',
      '/data-sources/ds-1',
    );
    expect(screen.getByRole('link', { name: /Playbook/ })).toHaveAttribute(
      'href',
      '/capabilities/cap-1',
    );
    expect(screen.getByRole('link', { name: /Team/ })).toHaveAttribute(
      'href',
      '/context-groups/cg-1',
    );
  });

  it('renders an unresolved reference as a non-clickable marker showing the slug', () => {
    renderMarkdown('Run @action:missing now.');

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('missing')).toBeInTheDocument();
    expect(screen.getByTitle('Unknown action: missing')).toBeInTheDocument();
  });
});
