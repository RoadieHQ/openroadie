// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@roadiehq/ui/button';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import { SuggestionInlineReview } from './suggestion-inline-review';

// The full editor is exercised elsewhere (relationship-rule-inspector.test.tsx
// and friends); this file only cares whether `rank` reaches onApprove/onDismiss.
vi.mock('./use-relationship-rule-editor', () => ({
  useRelationshipRuleEditor: () => ({}),
}));

vi.mock('./relationship-step-editor', () => ({
  RelationshipStepEditor: () => <div data-testid="step-editor" />,
}));

vi.mock('./relationship-rule-inspector', () => ({
  RelationshipRuleInspectorActions: (props: {
    onApprove?: (ruleId: string) => Promise<void>;
    onDelete?: (ruleId: string) => Promise<void | boolean>;
  }) => (
    <div>
      <Button type="button" onClick={() => void props.onApprove?.('rule-1')}>
        Approve
      </Button>
      <Button type="button" onClick={() => void props.onDelete?.('rule-1')}>
        Dismiss
      </Button>
    </div>
  ),
}));

function makeRule(overrides: Partial<RelationshipRule> = {}): RelationshipRule {
  return {
    id: 'rule-1',
    name: 'rule',
    description: null,
    sourceDatasourceId: 'source',
    targetDatasourceId: 'target',
    sourceFieldExpression: '$.handle',
    targetFieldExpression: '$.login',
    sourceFilterExpression: null,
    targetFilterExpression: null,
    relationshipType: 'ownedBy',
    reciprocalRelationshipType: 'ownerOf',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    origin: 'generated',
    state: 'suggested',
    suggestionKind: 'identity',
    score: null,
    confidenceBand: null,
    evidenceSummary: null,
    reviewReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderReview(
  overrides: Partial<React.ComponentProps<typeof SuggestionInlineReview>> = {},
) {
  const onApprove = vi.fn().mockResolvedValue(undefined);
  const onDismiss = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <SuggestionInlineReview
      rule={makeRule()}
      rules={[makeRule()]}
      sourceLabel="Source"
      targetLabel="Target"
      sourceFields={[]}
      targetFields={[]}
      onSave={vi.fn()}
      onApprove={onApprove}
      onDismiss={onDismiss}
      onPreview={undefined}
      onCollapse={vi.fn()}
      {...overrides}
    />,
  );
  return { ...utils, onApprove, onDismiss };
}

afterEach(() => {
  cleanup();
});

describe('SuggestionInlineReview rankShown threading', () => {
  it('passes the given rank through to onApprove', async () => {
    const user = userEvent.setup();
    const { onApprove } = renderReview({ rank: 2 });

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(onApprove).toHaveBeenCalledWith('rule-1', 2);
  });

  it('passes the given rank through to onDismiss', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderReview({ rank: 0 });

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onDismiss).toHaveBeenCalledWith('rule-1', 0);
  });

  it('passes undefined rank through rather than defaulting it', async () => {
    const user = userEvent.setup();
    const { onApprove } = renderReview();

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(onApprove).toHaveBeenCalledWith('rule-1', undefined);
  });
});
