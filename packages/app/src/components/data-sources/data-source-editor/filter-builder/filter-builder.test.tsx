import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RuleGroupType } from 'react-querybuilder';
import { FilterBuilder } from './filter-builder';

vi.mock('../jsonata-expression-field', async () => {
  const { Textarea } = await import('@roadiehq/ui/textarea');
  return {
    JsonataExpressionField: (props: {
      value: string;
      onChange: (v: string) => void;
      testId?: string;
    }) => (
      <Textarea
        data-testid={props.testId ?? 'jsonata-textarea'}
        value={props.value}
        onChange={e => props.onChange(e.target.value)}
      />
    ),
  };
});

const noop = () => {};

const sampleEntities = [
  { kind: 'Component', name: 'svc-a', count: 1 },
  { kind: 'API', name: 'api-a', count: 2 },
  { kind: 'Component', name: 'svc-b', count: 3 },
];

describe('FilterBuilder', () => {
  it('renders an empty structured builder when no filter and no expression are provided', () => {
    render(
      <FilterBuilder
        inputSample={sampleEntities}
        onChange={noop}
        testId="filter"
      />,
    );
    expect(
      screen.getByTestId('filter-builder-querybuilder'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('filter-builder-migration-banner'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('jsonata-textarea')).not.toBeInTheDocument();
  });

  it('hydrates structured mode directly from the filter prop', () => {
    const filter: RuleGroupType = {
      combinator: 'and',
      rules: [{ field: 'kind', operator: '=', value: 'Component' }],
    };
    render(
      <FilterBuilder
        filter={filter}
        inputSample={sampleEntities}
        onChange={noop}
      />,
    );
    expect(
      screen.getByTestId('filter-builder-querybuilder'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('filter-builder-migration-banner'),
    ).not.toBeInTheDocument();
  });

  it('hydrates structured mode from a parseable JSONata expression', () => {
    render(
      <FilterBuilder
        expression='kind = "Component"'
        inputSample={sampleEntities}
        onChange={noop}
      />,
    );
    expect(
      screen.getByTestId('filter-builder-querybuilder'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('filter-builder-migration-banner'),
    ).not.toBeInTheDocument();
  });

  it('opens in advanced mode for an unparseable expression', () => {
    render(
      <FilterBuilder
        expression='$count(items[$.kind = "X" or $.foo = (function($a){$a > 0})])'
        inputSample={sampleEntities}
        onChange={noop}
      />,
    );
    expect(screen.getByTestId('jsonata-textarea')).toBeInTheDocument();
    expect(
      screen.queryByTestId('filter-builder-querybuilder'),
    ).not.toBeInTheDocument();
  });

  it('toggling off advanced from an unparseable hydration prompts confirmation', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterBuilder
        expression='$count(items[$.kind = "X" or $.foo = (function($a){$a > 0})])'
        inputSample={sampleEntities}
        onChange={onChange}
      />,
    );
    const toggle = screen.getByRole('switch', { name: /advanced/i });
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(screen.queryByTestId('jsonata-textarea')).not.toBeInTheDocument();
    expect(
      screen.getByTestId('filter-builder-querybuilder'),
    ).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ combinator: 'and', rules: [] }),
      '',
    );
  });

  it('toggles to advanced mode and back without warning when textarea is pristine', async () => {
    const user = userEvent.setup();
    render(
      <FilterBuilder
        filter={{
          combinator: 'and',
          rules: [{ field: 'kind', operator: '=', value: 'Component' }],
        }}
        inputSample={sampleEntities}
        onChange={noop}
      />,
    );
    const toggle = screen.getByRole('switch', { name: /advanced/i });
    await user.click(toggle);
    expect(screen.getByTestId('jsonata-textarea')).toBeInTheDocument();
    expect(
      screen.queryByTestId('filter-builder-querybuilder'),
    ).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByTestId('jsonata-textarea')).not.toBeInTheDocument();
    expect(
      screen.getByTestId('filter-builder-querybuilder'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('filter-builder-confirm'),
    ).not.toBeInTheDocument();
  });

  it('asks for confirmation before leaving advanced mode if the textarea was edited', async () => {
    const user = userEvent.setup();
    render(
      <FilterBuilder
        filter={{
          combinator: 'and',
          rules: [{ field: 'kind', operator: '=', value: 'Component' }],
        }}
        inputSample={sampleEntities}
        onChange={noop}
      />,
    );
    const toggle = screen.getByRole('switch', { name: /advanced/i });
    await user.click(toggle);
    const textarea = screen.getByTestId('jsonata-textarea');
    await user.clear(textarea);
    await user.type(textarea, 'name = "svc-a"');

    await user.click(toggle);
    expect(screen.getByTestId('filter-builder-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('jsonata-textarea')).toBeInTheDocument();
  });

  it('cancelling the confirmation keeps the user in advanced mode', async () => {
    const user = userEvent.setup();
    render(
      <FilterBuilder
        filter={{
          combinator: 'and',
          rules: [{ field: 'kind', operator: '=', value: 'Component' }],
        }}
        inputSample={sampleEntities}
        onChange={noop}
      />,
    );
    const toggle = screen.getByRole('switch', { name: /advanced/i });
    await user.click(toggle);
    const textarea = screen.getByTestId('jsonata-textarea');
    await user.type(textarea, ' more');
    await user.click(toggle);

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(
      screen.queryByTestId('filter-builder-confirm'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('jsonata-textarea')).toBeInTheDocument();
    expect(
      screen.queryByTestId('filter-builder-querybuilder'),
    ).not.toBeInTheDocument();
  });

  it('confirming clears advanced state and re-parses the expression', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterBuilder
        filter={{
          combinator: 'and',
          rules: [{ field: 'kind', operator: '=', value: 'Component' }],
        }}
        inputSample={sampleEntities}
        onChange={onChange}
      />,
    );
    const toggle = screen.getByRole('switch', { name: /advanced/i });
    await user.click(toggle);
    const textarea = screen.getByTestId('jsonata-textarea');
    await user.clear(textarea);
    await user.type(textarea, 'name = "svc-a"');
    await user.click(toggle);

    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(
      screen.queryByTestId('filter-builder-confirm'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('filter-builder-querybuilder'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('jsonata-textarea')).not.toBeInTheDocument();

    const lastCall = onChange.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(
      expect.objectContaining({ combinator: 'and' }),
    );
    expect(typeof lastCall?.[1]).toBe('string');
    expect(lastCall?.[1]).toContain('name');
  });

  describe('boolean comparisons (sc-34595)', () => {
    const booleanSample = [
      { name: 'svc-a', archived: false },
      { name: 'svc-b', archived: true },
    ];

    it("compiles a rule stored with the string 'true' on a boolean field to a boolean comparison", async () => {
      const user = userEvent.setup();
      render(
        <FilterBuilder
          filter={{
            combinator: 'and',
            rules: [{ field: 'archived', operator: '=', value: 'true' }],
          }}
          inputSample={booleanSample}
          onChange={noop}
        />,
      );
      await user.click(screen.getByRole('switch', { name: /advanced/i }));
      expect(screen.getByTestId('jsonata-textarea')).toHaveValue(
        'archived = true',
      );
    });

    it("renders a string 'false' value as an off switch, not on", () => {
      render(
        <FilterBuilder
          filter={{
            combinator: 'and',
            rules: [{ field: 'archived', operator: '=', value: 'false' }],
          }}
          inputSample={booleanSample}
          onChange={noop}
        />,
      );
      expect(
        screen.getByRole('switch', { name: 'Boolean value' }),
      ).not.toBeChecked();
    });

    it("typing 'true' into the value of a field missing from the sample emits a boolean comparison", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <FilterBuilder inputSample={sampleEntities} onChange={onChange} />,
      );
      await user.click(screen.getByRole('button', { name: /rule/i }));
      const fieldInput = screen.getByRole('textbox', { name: 'Field' });
      await user.clear(fieldInput);
      await user.type(fieldInput, 'archived');
      await user.keyboard('{Escape}');
      await user.type(screen.getByPlaceholderText('value'), 'true');

      const lastCall = onChange.mock.calls.at(-1);
      expect(lastCall?.[1]).toBe('archived = true');
    });

    it('hydrates structured mode from a boolean JSONata expression and preserves it on recompile', async () => {
      const user = userEvent.setup();
      render(
        <FilterBuilder
          expression="archived = true"
          inputSample={booleanSample}
          onChange={noop}
        />,
      );
      expect(
        screen.getByTestId('filter-builder-querybuilder'),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('switch', { name: /advanced/i }));
      expect(screen.getByTestId('jsonata-textarea')).toHaveValue(
        'archived = true',
      );
    });
  });

  describe('not contains (sc-34595)', () => {
    it('compiles the doesNotContain operator to a negated $contains', async () => {
      const user = userEvent.setup();
      render(
        <FilterBuilder
          filter={{
            combinator: 'and',
            rules: [
              { field: 'name', operator: 'doesNotContain', value: 'svc' },
            ],
          }}
          inputSample={sampleEntities}
          onChange={noop}
        />,
      );
      await user.click(screen.getByRole('switch', { name: /advanced/i }));
      expect(screen.getByTestId('jsonata-textarea')).toHaveValue(
        '$not($contains(name, "svc"))',
      );
    });

    it('hydrates a negated $contains expression back into structured mode', () => {
      render(
        <FilterBuilder
          expression='$not($contains(name, "svc"))'
          inputSample={sampleEntities}
          onChange={noop}
        />,
      );
      expect(
        screen.getByTestId('filter-builder-querybuilder'),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('jsonata-textarea')).not.toBeInTheDocument();
    });
  });

  describe('is empty / is not empty (sc-34595)', () => {
    it('compiles is-empty with an existence check so missing fields match', async () => {
      const user = userEvent.setup();
      render(
        <FilterBuilder
          filter={{
            combinator: 'and',
            rules: [{ field: 'description', operator: 'null', value: '' }],
          }}
          inputSample={sampleEntities}
          onChange={noop}
        />,
      );
      await user.click(screen.getByRole('switch', { name: /advanced/i }));
      expect(screen.getByTestId('jsonata-textarea')).toHaveValue(
        '($not($exists(description)) or description = null)',
      );
    });

    it('hydrates a compiled is-empty expression back into structured mode', () => {
      render(
        <FilterBuilder
          expression="($not($exists(description)) or description = null)"
          inputSample={sampleEntities}
          onChange={noop}
        />,
      );
      expect(
        screen.getByTestId('filter-builder-querybuilder'),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('jsonata-textarea')).not.toBeInTheDocument();
    });

    it('still hydrates the legacy `field = null` form of is-empty', () => {
      render(
        <FilterBuilder
          expression="description = null"
          inputSample={sampleEntities}
          onChange={noop}
        />,
      );
      expect(
        screen.getByTestId('filter-builder-querybuilder'),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('jsonata-textarea')).not.toBeInTheDocument();
    });
  });

  it('editing the advanced textarea calls onChange with undefined filter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterBuilder inputSample={sampleEntities} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: /advanced/i });
    await user.click(toggle);
    onChange.mockClear();

    const textarea = screen.getByTestId('jsonata-textarea');
    await user.type(textarea, 'k');

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls.at(-1);
    expect(lastCall?.[0]).toBeUndefined();
    expect(typeof lastCall?.[1]).toBe('string');
  });
});
