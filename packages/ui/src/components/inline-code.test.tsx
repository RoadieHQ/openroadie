import React from 'react';
import { render, screen } from '@testing-library/react';

import { InlineCode } from './inline-code';

describe('InlineCode', () => {
  it('renders children as a code element and forwards ref', () => {
    const ref = React.createRef<HTMLElement>();
    render(<InlineCode ref={ref}>npm install</InlineCode>);
    expect(screen.getByText('npm install')).toBeInTheDocument();
    expect(screen.getByText('npm install').tagName).toBe('CODE');
    expect(ref.current).toBeInstanceOf(HTMLElement);
  });
});
