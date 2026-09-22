import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { MentionsTextField } from './mentions-text-field';
import { getPlainText } from './utils';
import type { SuggestionDataSource, BaseSuggestionData } from './types';

const secrets = [
  { id: 'GITHUB_TOKEN', display: 'GITHUB_TOKEN' },
  { id: 'AWS_SECRET_KEY', display: 'AWS_SECRET_KEY' },
  { id: 'DATADOG_API_KEY', display: 'DATADOG_API_KEY' },
];

const secretsDataSource: SuggestionDataSource<BaseSuggestionData> = {
  trigger: '@',
  markup: '@[__display__](__id__)',
  displayTransform: (id: string, display?: string) => `\${${display || id}}`,
  data: async (query: string) =>
    secrets.filter(s => s.display.toLowerCase().includes(query.toLowerCase())),
};

describe('MentionsTextField', () => {
  it('renders with placeholder', () => {
    render(
      <MentionsTextField
        dataSources={[secretsDataSource]}
        placeholder="Type @ to insert a secret"
      />,
    );
    expect(
      screen.getByPlaceholderText('Type @ to insert a secret'),
    ).toBeInTheDocument();
  });

  it('displays plain text from markup value', () => {
    render(
      <MentionsTextField
        dataSources={[secretsDataSource]}
        value="@[GITHUB_TOKEN](GITHUB_TOKEN)"
        placeholder="field"
      />,
    );
    expect(screen.getByPlaceholderText('field')).toHaveValue('${GITHUB_TOKEN}');
  });

  it('calls onChange when typing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MentionsTextField
        dataSources={[secretsDataSource]}
        onChange={onChange}
        placeholder="field"
      />,
    );

    await user.type(screen.getByPlaceholderText('field'), 'hello');
    expect(onChange).toHaveBeenCalled();
  });

  it('shows suggestion dropdown when @ is typed', async () => {
    const user = userEvent.setup();
    render(
      <MentionsTextField
        dataSources={[secretsDataSource]}
        placeholder="field"
      />,
    );

    await user.type(screen.getByPlaceholderText('field'), '@');

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    expect(screen.getByText('GITHUB_TOKEN')).toBeInTheDocument();
    expect(screen.getByText('AWS_SECRET_KEY')).toBeInTheDocument();
  });

  it('filters suggestions based on query', async () => {
    const user = userEvent.setup();
    render(
      <MentionsTextField
        dataSources={[secretsDataSource]}
        placeholder="field"
      />,
    );

    await user.type(screen.getByPlaceholderText('field'), '@GIT');

    await waitFor(() => {
      expect(screen.getByText('GITHUB_TOKEN')).toBeInTheDocument();
    });

    expect(screen.queryByText('AWS_SECRET_KEY')).not.toBeInTheDocument();
  });

  it('inserts mention on click and closes the dropdown', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    // Use a wrapper that feeds onChange values back to the component
    function Wrapper() {
      const [value, setValue] = React.useState('');
      return (
        <MentionsTextField
          dataSources={[secretsDataSource]}
          value={value}
          onChange={(newValue, plainText, mentions) => {
            setValue(newValue);
            onChange(newValue, plainText, mentions);
          }}
          placeholder="field"
        />
      );
    }

    render(<Wrapper />);

    await user.type(screen.getByPlaceholderText('field'), '@');

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    await user.click(screen.getByText('GITHUB_TOKEN'));

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(lastCall[0]).toContain('@[GITHUB_TOKEN](GITHUB_TOKEN)');

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  it('closes suggestions on blur', async () => {
    const user = userEvent.setup();
    render(
      <MentionsTextField
        dataSources={[secretsDataSource]}
        placeholder="field"
      />,
    );

    await user.type(screen.getByPlaceholderText('field'), '@');

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    // Blur the input by tabbing away (Tab is intercepted by keyboard nav,
    // so use fireEvent.blur instead)
    fireEvent.blur(screen.getByPlaceholderText('field'));

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });
});

describe('getPlainText', () => {
  it('converts markup to display text', () => {
    const result = getPlainText('@[GITHUB_TOKEN](GITHUB_TOKEN)', [
      secretsDataSource,
    ]);
    expect(result).toBe('${GITHUB_TOKEN}');
  });

  it('preserves plain text without mentions', () => {
    const result = getPlainText('Bearer token123', [secretsDataSource]);
    expect(result).toBe('Bearer token123');
  });

  it('handles mixed content', () => {
    const result = getPlainText('Bearer @[GITHUB_TOKEN](GITHUB_TOKEN)', [
      secretsDataSource,
    ]);
    expect(result).toBe('Bearer ${GITHUB_TOKEN}');
  });

  it('handles empty string', () => {
    const result = getPlainText('', [secretsDataSource]);
    expect(result).toBe('');
  });
});
