import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { MapBuilder } from './map-builder';

const sampleEntities = [
  {
    kind: 'Component',
    metadata: { name: 'svc-a', namespace: 'team-a' },
    count: 1,
  },
  {
    kind: 'API',
    metadata: { name: 'api-a', namespace: 'team-b' },
    count: 2,
  },
];

const meta = {
  title: 'DataSources/MapBuilder',
  component: MapBuilder,
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof MapBuilder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
  },
};

export const FlatLiteralOverrides: Story = {
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
    rules: {
      passthrough: true,
      overrides: [
        {
          id: 'a',
          targetPath: 'kind',
          source: { kind: 'literal', valueType: 'string', value: 'Service' },
        },
        {
          id: 'b',
          targetPath: 'count',
          source: { kind: 'literal', valueType: 'number', value: 0 },
        },
      ],
    },
  },
};

export const NestedOverride: Story = {
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
    rules: {
      passthrough: true,
      overrides: [
        {
          id: 'a',
          targetPath: 'metadata.namespace',
          source: { kind: 'literal', valueType: 'string', value: 'default' },
        },
      ],
    },
  },
};

export const FieldRename: Story = {
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
    rules: {
      passthrough: false,
      overrides: [
        {
          id: 'a',
          targetPath: 'displayName',
          source: { kind: 'field', path: 'metadata.name' },
        },
        {
          id: 'b',
          targetPath: 'category',
          source: { kind: 'field', path: 'kind' },
        },
      ],
    },
  },
};

export const HydratedFromExpression: Story = {
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
    expression:
      '$merge([$, {"metadata": $merge([metadata, {"namespace": "default"}])}])',
  },
};

export const UnparseableExpression: Story = {
  name: 'Unparseable → opens in advanced',
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
    expression: '$map(items, function($i){$i.kind})',
  },
};

export const AllSourceKinds: Story = {
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
    rules: {
      passthrough: true,
      overrides: [
        {
          id: 'a',
          targetPath: 'kind',
          source: { kind: 'literal', valueType: 'string', value: 'Service' },
        },
        {
          id: 'b',
          targetPath: 'count',
          source: { kind: 'literal', valueType: 'number', value: 0 },
        },
        {
          id: 'c',
          targetPath: 'active',
          source: { kind: 'literal', valueType: 'boolean', value: true },
        },
        {
          id: 'd',
          targetPath: 'note',
          source: { kind: 'literal', valueType: 'null', value: null },
        },
        {
          id: 'e',
          targetPath: 'displayName',
          source: { kind: 'field', path: 'metadata.name' },
        },
        {
          id: 'f',
          targetPath: 'fingerprint',
          source: {
            kind: 'expression',
            expression: '$base64encode(metadata.name & ":" & kind)',
          },
        },
      ],
    },
  },
};

export const PassthroughOff: Story = {
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
    rules: {
      passthrough: false,
      overrides: [
        {
          id: 'a',
          targetPath: 'kind',
          source: { kind: 'field', path: 'kind' },
        },
        {
          id: 'b',
          targetPath: 'name',
          source: { kind: 'field', path: 'metadata.name' },
        },
        {
          id: 'c',
          targetPath: 'category',
          source: { kind: 'literal', valueType: 'string', value: 'service' },
        },
      ],
    },
  },
};

export const AdvancedModeFromStart: Story = {
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
    expression: '$map(items, function($i){$i.kind})',
  },
};

export const HydratedFromIdentity: Story = {
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
    expression: '$',
  },
};

export const PassthroughWithOmit: Story = {
  name: 'Passthrough + omit (Xantier feature)',
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
    rules: {
      passthrough: true,
      omit: ['count'],
      overrides: [
        {
          id: 'a',
          targetPath: 'kind',
          source: { kind: 'literal', valueType: 'string', value: 'Service' },
        },
      ],
    },
  },
};
