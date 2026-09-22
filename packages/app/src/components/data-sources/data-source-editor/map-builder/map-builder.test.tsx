import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapBuilder } from './map-builder';
import type { MapRules } from './types';

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
  { kind: 'Component', metadata: { name: 'svc-a', namespace: 'team-a' } },
  { kind: 'API', metadata: { name: 'api-a', namespace: 'team-b' } },
];

describe('MapBuilder', () => {
  it('renders an empty structured builder with passthrough on by default when no props are provided', () => {
    render(
      <MapBuilder inputSample={sampleEntities} onChange={noop} testId="map" />,
    );
    expect(screen.getByTestId('map-builder-builder')).toBeInTheDocument();
    expect(
      screen.queryByTestId('map-builder-migration-banner'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('jsonata-textarea')).not.toBeInTheDocument();
    const passthrough = screen.getByRole('switch', { name: /pass through/i });
    expect(passthrough).toBeChecked();
    expect(screen.queryAllByTestId(/^map-row-/)).toHaveLength(0);
  });

  it('hydrates structured mode directly from the rules prop', () => {
    const rules: MapRules = {
      passthrough: true,
      overrides: [
        {
          id: 'a',
          targetPath: 'kind',
          source: { kind: 'literal', valueType: 'string', value: 'Component' },
        },
      ],
    };
    render(
      <MapBuilder rules={rules} inputSample={sampleEntities} onChange={noop} />,
    );
    expect(screen.getByDisplayValue('kind')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Component')).toBeInTheDocument();
  });

  it('hydrates from a parseable JSONata expression', () => {
    render(
      <MapBuilder
        expression='$merge([$, {"kind": "Component"}])'
        inputSample={sampleEntities}
        onChange={noop}
      />,
    );
    expect(screen.getByDisplayValue('kind')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Component')).toBeInTheDocument();
    expect(
      screen.queryByTestId('map-builder-migration-banner'),
    ).not.toBeInTheDocument();
  });

  it('opens in advanced mode for unparseable expressions', () => {
    render(
      <MapBuilder
        expression="$map(items, function($i){$i.kind})"
        inputSample={sampleEntities}
        onChange={noop}
      />,
    );
    expect(screen.getByTestId('jsonata-textarea')).toBeInTheDocument();
    expect(screen.queryByTestId('map-builder-builder')).not.toBeInTheDocument();
  });

  it('toggling off advanced from an unparseable hydration prompts confirmation', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MapBuilder
        expression="$map(items, function($i){$i.kind})"
        inputSample={sampleEntities}
        onChange={onChange}
      />,
    );
    const toggle = screen.getByRole('switch', { name: /advanced/i });
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(screen.getByTestId('map-builder-builder')).toBeInTheDocument();
    const lastCall = onChange.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual({ passthrough: true, overrides: [] });
    expect(lastCall?.[1]).toBe('$');
  });

  it('adding a row fires onChange with both rules and compiled expression', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MapBuilder inputSample={sampleEntities} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /^override$/i }));
    const lastCall = onChange.mock.calls.at(-1);
    expect(lastCall?.[0]?.overrides).toHaveLength(1);
    expect(typeof lastCall?.[1]).toBe('string');
  });

  it('editing a row target path updates the rules and compiled expression', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const rules: MapRules = {
      passthrough: true,
      overrides: [
        {
          id: 'a',
          targetPath: 'kind',
          source: { kind: 'literal', valueType: 'string', value: 'Component' },
        },
      ],
    };
    render(
      <MapBuilder
        rules={rules}
        inputSample={sampleEntities}
        onChange={onChange}
      />,
    );
    const targetInput = screen.getByDisplayValue('kind');
    await user.clear(targetInput);
    await user.type(targetInput, 'category');

    const lastCall = onChange.mock.calls.at(-1);
    expect(lastCall?.[0]?.overrides[0]?.targetPath).toBe('category');
    expect(lastCall?.[1]).toContain('category');
  });

  it('removing a row updates the rules', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const rules: MapRules = {
      passthrough: true,
      overrides: [
        {
          id: 'a',
          targetPath: 'kind',
          source: { kind: 'literal', valueType: 'string', value: 'Component' },
        },
      ],
    };
    render(
      <MapBuilder
        rules={rules}
        inputSample={sampleEntities}
        onChange={onChange}
      />,
    );
    const row = screen.getByTestId(/^map-row-/);
    await user.click(within(row).getByRole('button', { name: /remove/i }));
    const lastCall = onChange.mock.calls.at(-1);
    expect(lastCall?.[0]?.overrides).toHaveLength(0);
    expect(lastCall?.[1]).toBe('$');
  });

  it('toggling passthrough off updates the compiled expression', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const rules: MapRules = {
      passthrough: true,
      overrides: [
        {
          id: 'a',
          targetPath: 'kind',
          source: { kind: 'literal', valueType: 'string', value: 'Component' },
        },
      ],
    };
    render(
      <MapBuilder
        rules={rules}
        inputSample={sampleEntities}
        onChange={onChange}
      />,
    );
    const passthrough = screen.getByRole('switch', { name: /pass through/i });
    await user.click(passthrough);
    const lastCall = onChange.mock.calls.at(-1);
    expect(lastCall?.[0]?.passthrough).toBe(false);
    expect(lastCall?.[1]).toBe('{"kind": "Component"}');
  });

  it('toggles a field via the multi-picker and writes the omit array', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MapBuilder
        rules={{
          passthrough: true,
          overrides: [
            {
              id: 'a',
              targetPath: 'kind',
              source: { kind: 'literal', valueType: 'string', value: 'C' },
            },
          ],
        }}
        inputSample={sampleEntities}
        onChange={onChange}
      />,
    );

    const trigger = screen.getByTestId('map-builder-omit-picker-add');
    await user.click(trigger);
    await user.click(screen.getByTestId('map-builder-omit-picker-option-kind'));

    const lastCall = onChange.mock.calls.at(-1);
    expect(lastCall?.[0]?.omit).toEqual(['kind']);
    expect(lastCall?.[1]).toContain('$sift');
  });

  it('hides the omit picker when passthrough is off', async () => {
    const user = userEvent.setup();
    render(
      <MapBuilder
        rules={{
          passthrough: true,
          overrides: [],
          omit: ['kind'],
        }}
        inputSample={sampleEntities}
        onChange={noop}
      />,
    );

    expect(screen.getByTestId('map-builder-omit-picker')).toBeInTheDocument();

    const passthrough = screen.getByRole('switch', { name: /pass through/i });
    await user.click(passthrough);

    expect(
      screen.queryByTestId('map-builder-omit-picker'),
    ).not.toBeInTheDocument();
  });

  it('asks for confirmation before leaving advanced mode if the textarea was edited', async () => {
    const user = userEvent.setup();
    render(
      <MapBuilder
        rules={{ passthrough: true, overrides: [] }}
        inputSample={sampleEntities}
        onChange={noop}
      />,
    );
    const advanced = screen.getByRole('switch', { name: /advanced/i });
    await user.click(advanced);
    const textarea = screen.getByTestId('jsonata-textarea');
    await user.type(textarea, ' weirdness');

    await user.click(advanced);
    expect(screen.getByTestId('map-builder-confirm')).toBeInTheDocument();
  });
});
