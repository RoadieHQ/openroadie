import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Textarea } from '@roadiehq/ui/textarea';
import { JsonEditor } from './json-editor';

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    id,
    'data-testid': dataTestId,
  }: {
    value: string;
    onChange: (value: string) => void;
    id?: string;
    'data-testid'?: string;
  }) => (
    <Textarea
      id={id}
      data-testid={dataTestId}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  ),
}));

vi.mock('@codemirror/lang-json', () => ({
  json: () => [],
  jsonParseLinter: () => () => [],
}));
vi.mock('@codemirror/lint', () => ({ linter: () => [] }));

describe('JsonEditor', () => {
  it('renders the value', () => {
    render(
      <JsonEditor
        ariaLabel="Test JSON"
        id="test-json"
        value='{"a": 1}'
        onChange={() => {}}
        data-testid="test-json"
      />,
    );
    expect(screen.getByTestId('test-json')).toHaveValue('{"a": 1}');
  });

  it('propagates edits through onChange', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <JsonEditor
        ariaLabel="Test JSON"
        id="test-json"
        value=""
        onChange={onChange}
        data-testid="test-json"
      />,
    );
    await user.type(screen.getByTestId('test-json'), 'x');
    expect(onChange).toHaveBeenCalledWith('x');
  });

  it('shows the error line when error is set', () => {
    render(
      <JsonEditor
        ariaLabel="Test JSON"
        id="test-json"
        value="{oops"
        onChange={() => {}}
        error="Request body JSON is invalid: Unexpected token"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Request body JSON is invalid: Unexpected token',
    );
  });

  it('shows no error line when error is null', () => {
    render(
      <JsonEditor
        id="test-json"
        ariaLabel="Test JSON"
        value="{}"
        onChange={() => {}}
        error={null}
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps an initial content-based height while editing', () => {
    const initialValue = Array.from({ length: 10 }, (_, index) => index).join(
      '\n',
    );
    const { container, rerender } = render(
      <JsonEditor
        id="test-json"
        ariaLabel="Test JSON"
        value={initialValue}
        onChange={() => {}}
        height="auto"
        minHeight="120px"
        maxHeight="60vh"
        resizable
      />,
    );

    expect(container.firstChild).toHaveStyle({
      height: '228px',
      minHeight: '120px',
      maxHeight: '60vh',
    });

    rerender(
      <JsonEditor
        id="test-json"
        ariaLabel="Test JSON"
        value={`${initialValue}\n10`}
        onChange={() => {}}
        height="auto"
        minHeight="120px"
        maxHeight="60vh"
        resizable
      />,
    );

    expect(container.firstChild).toHaveStyle({ height: '228px' });

    rerender(
      <JsonEditor
        id="test-json"
        ariaLabel="Test JSON"
        value={`${initialValue}\n10`}
        onChange={() => {}}
        height="auto"
        minHeight="120px"
        maxHeight="60vh"
        resizable
        resetKey="replacement"
      />,
    );

    expect(container.firstChild).toHaveStyle({ height: '248px' });
  });
});
