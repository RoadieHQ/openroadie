import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import type { EditorStateConfig } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Editor } from './editor';

let latestExtensions: EditorStateConfig['extensions'];
let latestDispatch = vi.fn();

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: function MockCodeMirror({
    value,
    onChange,
    onFocus,
    onBlur,
    readOnly,
    placeholder,
    basicSetup,
    height,
    minHeight,
    maxHeight,
    extensions,
    onCreateEditor,
  }: {
    value: string;
    onChange: (value: string) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    readOnly?: boolean;
    placeholder?: string;
    basicSetup?: unknown;
    height?: string;
    minHeight?: string;
    maxHeight?: string;
    extensions?: EditorStateConfig['extensions'];
    onCreateEditor?: (view: EditorView) => void;
  }) {
    const state = React.useMemo(() => EditorState.create({ doc: value }), []);
    latestExtensions = extensions;

    React.useEffect(() => {
      // The component only reads `state` and `dispatch` off the view, so the
      // stub supplies those two rather than a whole EditorView.
      onCreateEditor?.({
        state,
        dispatch: latestDispatch,
      } as unknown as EditorView);
    }, [onCreateEditor, state]);

    return (
      <textarea
        aria-label="Code editor"
        data-basic-setup={JSON.stringify(basicSetup)}
        data-height={height}
        data-max-height={maxHeight}
        data-min-height={minHeight}
        onBlur={onBlur}
        onChange={event => onChange(event.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        readOnly={readOnly}
        value={value}
      />
    );
  },
}));

describe('Editor', () => {
  it('preserves focused edits when the parent rerenders with a stale value', () => {
    function StaleParent() {
      const [, setRevision] = React.useState(0);
      return (
        <Editor
          value=""
          onChange={() => setRevision(revision => revision + 1)}
        />
      );
    }

    render(<StaleParent />);

    const editor = screen.getByRole('textbox', { name: 'Code editor' });
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: '{"name": "Roadie"}' } });

    expect(editor).toHaveValue('{"name": "Roadie"}');
  });

  it('adopts an external value change immediately while not focused', () => {
    const { rerender } = render(<Editor value="first" onChange={() => {}} />);

    const editor = screen.getByRole('textbox', { name: 'Code editor' });
    expect(editor).toHaveValue('first');

    rerender(<Editor value="second" onChange={() => {}} />);

    expect(editor).toHaveValue('second');
  });

  it('keeps pending edits on blur when the parent value is still stale', () => {
    const onChange = vi.fn();
    render(<Editor value="" onChange={onChange} />);

    const editor = screen.getByRole('textbox', { name: 'Code editor' });
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: '{"name": "Roadie"}' } });
    fireEvent.blur(editor);

    expect(onChange).toHaveBeenCalledWith('{"name": "Roadie"}');
    expect(editor).toHaveValue('{"name": "Roadie"}');
  });

  it('adopts an external value change immediately while focused', () => {
    const { rerender } = render(<Editor value="" onChange={() => {}} />);

    const editor = screen.getByRole('textbox', { name: 'Code editor' });
    fireEvent.focus(editor);
    rerender(<Editor value='{"from":"parent"}' onChange={() => {}} />);

    expect(editor).toHaveValue('{"from":"parent"}');
  });

  it('preserves newer local edits when a parent echoes an older value', () => {
    const { rerender } = render(<Editor value="" onChange={() => {}} />);

    const editor = screen.getByRole('textbox', { name: 'Code editor' });
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: 'first edit' } });
    fireEvent.change(editor, { target: { value: 'newer edit' } });

    rerender(<Editor value="first edit" onChange={() => {}} />);

    expect(editor).toHaveValue('newer edit');
  });

  it('adopts an explicit programmatic reset over in-flight focused edits', () => {
    const { rerender } = render(<Editor value="" onChange={() => {}} />);

    const editor = screen.getByRole('textbox', { name: 'Code editor' });
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: 'draft in progress' } });
    expect(editor).toHaveValue('draft in progress');

    rerender(
      <Editor
        value="restored from version history"
        onChange={() => {}}
        resetKey="version-2"
      />,
    );

    expect(editor).toHaveValue('restored from version history');
  });

  it('sizes the wrapper and fills CodeMirror when resizable', () => {
    const { container } = render(
      <Editor
        value=""
        onChange={() => {}}
        height="220px"
        minHeight="120px"
        maxHeight="480px"
        resizable
      />,
    );

    expect(container.firstChild).toHaveClass('resize-y');
    expect(container.firstChild).toHaveStyle({
      height: '220px',
      minHeight: '120px',
      maxHeight: '480px',
    });

    const editor = screen.getByRole('textbox', { name: 'Code editor' });
    expect(editor).toHaveAttribute('data-height', '100%');
    expect(editor).not.toHaveAttribute('data-min-height');
    expect(editor).not.toHaveAttribute('data-max-height');
  });

  it('passes fixed heights through to CodeMirror when not resizable', () => {
    render(
      <Editor
        value=""
        onChange={() => {}}
        height="180px"
        minHeight="100px"
        maxHeight="400px"
      />,
    );

    const editor = screen.getByRole('textbox', { name: 'Code editor' });
    expect(editor).toHaveAttribute('data-height', '180px');
    expect(editor).toHaveAttribute('data-min-height', '100px');
    expect(editor).toHaveAttribute('data-max-height', '400px');
  });

  it('shows an accessible external error without masking editor content', () => {
    render(
      <Editor
        value="{invalid"
        onChange={() => {}}
        error="Invalid JSON"
        aria-label="Request body"
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Code editor' })).toHaveValue(
      '{invalid',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid JSON');

    const contentAttributes = EditorState.create({
      extensions: latestExtensions,
    }).facet(EditorView.contentAttributes);
    expect(contentAttributes).toContainEqual(
      expect.objectContaining({
        'aria-describedby': expect.any(String),
        'aria-invalid': 'true',
        'aria-label': 'Request body',
      }),
    );
  });

  it('clears diagnostics after callers remove them', () => {
    latestDispatch = vi.fn();
    const { rerender } = render(
      <Editor
        value="invalid"
        onChange={() => {}}
        diagnostics={[{ line: 1, message: 'Invalid value' }]}
      />,
    );
    const dispatchedWithDiagnostics = latestDispatch.mock.calls.length;

    rerender(<Editor value="valid" onChange={() => {}} />);

    expect(latestDispatch.mock.calls.length).toBeGreaterThan(
      dispatchedWithDiagnostics,
    );
  });

  it('uses the compact editor baseline while allowing caller overrides', () => {
    render(
      <Editor
        value=""
        onChange={() => {}}
        setup={{ lineNumbers: true, autocompletion: false }}
      />,
    );

    const setup = JSON.parse(
      screen
        .getByRole('textbox', { name: 'Code editor' })
        .getAttribute('data-basic-setup') ?? '{}',
    ) as Record<string, unknown>;

    expect(setup).toMatchObject({
      allowMultipleSelections: false,
      autocompletion: false,
      closeBrackets: true,
      drawSelection: true,
      lineNumbers: true,
      syntaxHighlighting: false,
    });
  });
});
