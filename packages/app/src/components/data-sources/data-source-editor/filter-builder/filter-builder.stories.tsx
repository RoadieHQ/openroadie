import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { FilterBuilder } from './filter-builder';

const sampleEntities = [
  { kind: 'Component', name: 'svc-a', count: 1, active: true },
  { kind: 'API', name: 'api-a', count: 2, active: false },
  { kind: 'Component', name: 'svc-b', count: 3, active: true },
  {
    kind: 'Component',
    name: 'svc-c',
    count: 4,
    active: false,
    metadata: { namespace: 'team-a', tier: 'platinum' },
  },
];

const meta = {
  title: 'DataSources/FilterBuilder',
  component: FilterBuilder,
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof FilterBuilder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
  },
};

export const HydratedFromFilter: Story = {
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
    filter: {
      combinator: 'and',
      rules: [
        { field: 'kind', operator: '=', value: 'Component' },
        { field: 'count', operator: '>', value: 2 },
      ],
    },
  },
};

export const HydratedFromExpression: Story = {
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
    expression: 'kind = "Component" and count > 2',
  },
};

export const NestedGroups: Story = {
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
    filter: {
      combinator: 'and',
      rules: [
        { field: 'active', operator: '=', value: true },
        {
          combinator: 'or',
          rules: [
            { field: 'kind', operator: '=', value: 'Component' },
            { field: 'kind', operator: '=', value: 'API' },
          ],
        },
      ],
    },
  },
};

export const UnparseableExpression: Story = {
  name: 'Unparseable → opens in advanced',
  args: {
    inputSample: sampleEntities,
    onChange: fn(),
    expression: '$count(items[$.kind = "X"]) > 0',
  },
};

const mixedTypeSample = [
  {
    kind: 'Component',
    name: 'svc-a',
    count: 3,
    active: true,
    deployedAt: '2024-01-15T10:00:00Z',
    tier: 'gold',
  },
  {
    kind: 'API',
    name: 'api-a',
    count: 7,
    active: false,
    deployedAt: '2024-02-20T09:30:00Z',
    tier: 'silver',
  },
  {
    kind: 'Component',
    name: 'svc-b',
    count: 12,
    active: true,
    deployedAt: '2024-03-05T14:15:00Z',
    tier: 'gold',
  },
];

export const AllFieldTypes: Story = {
  args: {
    inputSample: mixedTypeSample,
    onChange: fn(),
    filter: {
      combinator: 'and',
      rules: [
        { field: 'kind', operator: '=', value: 'Component' },
        { field: 'count', operator: '>=', value: 3 },
        { field: 'active', operator: '=', value: true },
        { field: 'deployedAt', operator: '>', value: '2024-02-01' },
        { field: 'tier', operator: 'in', value: 'gold,silver' },
      ],
    },
  },
};

export const ExistsAndEmptyOperators: Story = {
  args: {
    inputSample: mixedTypeSample,
    onChange: fn(),
    filter: {
      combinator: 'and',
      rules: [
        { field: 'name', operator: 'notNull', value: '' },
        { field: 'kind', operator: 'contains', value: 'Comp' },
      ],
    },
  },
};

export const AdvancedModeFromStart: Story = {
  args: {
    inputSample: mixedTypeSample,
    onChange: fn(),
    expression: '$count(items[$.kind = "X"]) > 0 and $sum(values) > $threshold',
  },
};
