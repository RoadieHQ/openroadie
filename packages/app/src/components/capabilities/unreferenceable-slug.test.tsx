import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  UnreferenceableSlugIcon,
  slugTriggerTooltip,
  unreferenceableSlugMessage,
} from './unreferenceable-slug';

describe('UnreferenceableSlugIcon', () => {
  it('renders nothing for a referenceable slug', () => {
    render(
      <UnreferenceableSlugIcon type="datasource" slug="sentry-projects" />,
    );
    expect(
      screen.queryByTestId('unreferenceable-slug'),
    ).not.toBeInTheDocument();
  });

  it('renders nothing when there is no slug yet', () => {
    render(<UnreferenceableSlugIcon type="action" slug={undefined} />);
    expect(
      screen.queryByTestId('unreferenceable-slug'),
    ).not.toBeInTheDocument();
  });

  it('flags a slug the token grammar can never match', () => {
    render(<UnreferenceableSlugIcon type="datasource" slug="My Source" />);
    const icon = screen.getByTestId('unreferenceable-slug');
    expect(icon).toHaveAccessibleName(
      expect.stringContaining('@datasource:My Source'),
    );
  });
});

describe('slugTriggerTooltip', () => {
  it('keeps the normal hint for a valid slug', () => {
    expect(slugTriggerTooltip('capability', 'deploy', 'Edit slug')).toBe(
      'Edit slug',
    );
  });

  it('keeps the normal hint when there is no slug', () => {
    expect(slugTriggerTooltip('capability', '', 'Edit slug')).toBe('Edit slug');
  });

  it('explains why an invalid slug is unusable', () => {
    expect(slugTriggerTooltip('action', 'Bad_Slug', 'Edit slug')).toBe(
      unreferenceableSlugMessage('action', 'Bad_Slug'),
    );
  });
});

describe('unreferenceableSlugMessage', () => {
  it('names the token that would fail to resolve', () => {
    expect(unreferenceableSlugMessage('context-group', 'My_Group')).toContain(
      '@context-group:My_Group',
    );
  });
});
