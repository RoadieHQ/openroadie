import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from './collapsible';

describe('Collapsible', () => {
  it('collapses content when trigger is clicked again', async () => {
    const user = userEvent.setup();
    render(
      <Collapsible>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Hidden content</CollapsibleContent>
      </Collapsible>,
    );

    expect(screen.queryByText('Hidden content')).not.toBeInTheDocument();
    await user.click(screen.getByText('Toggle'));
    expect(screen.getByText('Hidden content')).toBeInTheDocument();
    await user.click(screen.getByText('Toggle'));
    expect(screen.queryByText('Hidden content')).not.toBeInTheDocument();
  });

  it('renders open by default when defaultOpen is set', () => {
    render(
      <Collapsible defaultOpen>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Visible content</CollapsibleContent>
      </Collapsible>,
    );

    expect(screen.getByText('Visible content')).toBeInTheDocument();
  });
});
