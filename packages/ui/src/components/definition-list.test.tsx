import React from 'react';
import { render, screen } from '@testing-library/react';

import { DefinitionList, DefinitionItem } from './definition-list';

describe('DefinitionList', () => {
  it('renders label/value pairs', () => {
    render(
      <DefinitionList>
        <DefinitionItem label="Status">Active</DefinitionItem>
        <DefinitionItem label="Objects">1,204</DefinitionItem>
      </DefinitionList>,
    );
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Objects')).toBeInTheDocument();
    expect(screen.getByText('1,204')).toBeInTheDocument();
  });

  it('renders an em dash for empty values', () => {
    render(
      <DefinitionList>
        <DefinitionItem label="Owner" />
        <DefinitionItem label="Notes">{''}</DefinitionItem>
      </DefinitionList>,
    );
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});
