// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Button } from '@roadiehq/ui/button';
import { RelationshipRuleEditPage } from './relationships-standalone-pages';

const mockAlertApi = { post: vi.fn() };
vi.mock('../../api', () => ({
  useAlert: () => mockAlertApi,
}));

const mockDeleteRule = vi.fn().mockResolvedValue(undefined);
const mockSaveRule = vi.fn().mockResolvedValue(undefined);
const mockPreviewRule = vi.fn();
vi.mock(
  '../data-sources/relationships-editor/use-relationship-rule-mutations',
  () => ({
    useRelationshipRuleMutations: () => ({
      saveRule: mockSaveRule,
      deleteRule: mockDeleteRule,
      previewRule: mockPreviewRule,
    }),
  }),
);

const mockApproveSuggestion = vi.fn().mockResolvedValue(undefined);
const mockDismissSuggestion = vi.fn().mockResolvedValue(undefined);
vi.mock('../data-sources/relationships-editor/use-suggestion-review', () => ({
  useSuggestionReview: () => ({
    approveSuggestion: mockApproveSuggestion,
    dismissSuggestion: mockDismissSuggestion,
    pendingRuleIds: new Set(),
  }),
}));

// The full editor is exercised elsewhere; here we only care which destructive
// handler and label the page threads down, so stub it and capture props.
vi.mock(
  '../data-sources/relationships-editor/use-relationship-rule-editor',
  () => ({
    useRelationshipRuleEditor: () => ({}),
  }),
);

let capturedInspectorProps: {
  onDelete?: (ruleId: string) => Promise<void>;
  deleteLabel?: string;
};
vi.mock(
  '../data-sources/relationships-editor/relationship-rule-inspector',
  () => ({
    RelationshipRuleInspectorActions: (props: {
      onDelete?: (ruleId: string) => Promise<void | boolean>;
      deleteLabel?: string;
    }) => {
      return (
        <Button type="button" onClick={() => void props.onDelete?.('rule-1')}>
          {props.deleteLabel ?? 'Delete'}
        </Button>
      );
    },
    RelationshipRuleInspector: (props: {
      onDelete?: (ruleId: string) => Promise<void>;
      deleteLabel?: string;
    }) => {
      capturedInspectorProps = props;
      return <div data-testid="inspector" />;
    },
  }),
);

let mockRule:
  | { id: string; name: string; state: string; [key: string]: unknown }
  | undefined;
vi.mock('../data-sources/use-relationships-catalog', () => ({
  useRelationshipsCatalog: () => ({
    dataSources: [],
    // Empty so "View in graph" (which needs both endpoints enabled) stays off.
    enabledDataSources: [],
    datasourceLabels: new Map<string, string>(),
    schemaByDatasourceId: new Map(),
    rules: mockRule ? [mockRule] : [],
    loading: false,
    error: undefined,
  }),
}));

function ruleWith(state: string) {
  return {
    id: 'rule-1',
    name: 'My rule',
    state,
    sourceDatasourceId: 'ds-1',
    targetDatasourceId: 'ds-2',
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/relationships/rule-1']}>
      <Routes>
        <Route
          path="/relationships/:ruleId"
          element={<RelationshipRuleEditPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedInspectorProps = {};
});

afterEach(() => {
  cleanup();
});

describe('RelationshipRuleEditPage destructive action', () => {
  it('dismisses (not deletes) a suggested rule and labels the control "Dismiss"', async () => {
    const user = userEvent.setup();
    mockRule = ruleWith('suggested');
    renderPage();

    const control = screen.getByRole('button', { name: 'Dismiss' });
    expect(control).toBeInTheDocument();
    expect(capturedInspectorProps.deleteLabel).toBe('Dismiss');

    await user.click(control);

    expect(mockDismissSuggestion).toHaveBeenCalledWith('rule-1');
    expect(mockDeleteRule).not.toHaveBeenCalled();
  });

  it('hard-deletes a non-suggested rule and labels the control "Delete"', async () => {
    const user = userEvent.setup();
    mockRule = ruleWith('active');
    renderPage();

    const control = screen.getByRole('button', { name: 'Delete' });
    expect(control).toBeInTheDocument();
    expect(capturedInspectorProps.deleteLabel).toBe('Delete');

    await user.click(control);

    expect(mockDeleteRule).toHaveBeenCalledWith('rule-1');
    expect(mockDismissSuggestion).not.toHaveBeenCalled();
  });
});
