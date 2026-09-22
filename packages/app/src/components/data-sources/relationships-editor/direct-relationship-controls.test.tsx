// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@roadiehq/ui/button';
import type { RelationshipRulePreviewResult } from '../../../api/datastore/datastore-client';
import { MatchedRelationships } from './relationship-rule-preview';
import type { DirectRelationshipRowControls } from './direct-relationship-controls';
import type { DirectEdgeDraft } from './use-direct-relationships';

// The Link popover embeds the datasource-scoped object picker, which needs the
// full data plumbing — stub it with a single pickable object.
vi.mock('../objects/object-list-picker', () => ({
  ObjectListPicker: ({
    onObjectIdChange,
  }: {
    onObjectIdChange: (id: string) => void;
  }) => (
    <Button type="button" onClick={() => onObjectIdChange('tgt-9')}>
      Pick tgt-9
    </Button>
  ),
}));

function draft(
  targetObjectId: string,
  status: DirectEdgeDraft['status'],
  key = `k-${targetObjectId}`,
): DirectEdgeDraft {
  return { key, targetObjectId, status };
}

function makeControls(
  overrides: Partial<DirectRelationshipRowControls> = {},
): DirectRelationshipRowControls {
  return {
    targetDatasourceId: 'ds-2',
    targetLabels: new Map([
      ['tgt-1', 'Alice'],
      ['tgt-2', 'Bob'],
      ['tgt-3', 'Carol'],
    ]),
    onLink: vi.fn(),
    onRemove: vi.fn(),
    onUndo: vi.fn(),
    mutating: false,
    ...overrides,
  };
}

function renderPreview(
  controls: DirectRelationshipRowControls,
  directBySourceObjectId: Map<string, DirectEdgeDraft[]>,
) {
  const result: RelationshipRulePreviewResult = {
    items: [
      {
        sourceObjectId: 'p1',
        relationshipType: 'memberOf',
        targetObjectIds: [],
      },
      {
        sourceObjectId: 'a1',
        relationshipType: 'memberOf',
        targetObjectIds: [],
      },
      {
        sourceObjectId: 'r1',
        relationshipType: 'memberOf',
        targetObjectIds: [],
      },
      {
        sourceObjectId: 'u1',
        relationshipType: 'memberOf',
        targetObjectIds: [],
      },
    ],
    total: 4,
  };
  return render(
    <MatchedRelationships
      hasInputs
      loading={false}
      stale={false}
      error={null}
      result={result}
      sourceLabel="GitHub Users"
      targetLabel="Shortcut Users"
      sourceFieldExpression="$.email"
      targetFieldExpression="$.email"
      filter="all"
      directBySourceObjectId={directBySourceObjectId}
      directControls={controls}
    />,
  );
}

const drafts = new Map<string, DirectEdgeDraft[]>([
  ['p1', [draft('tgt-1', 'persisted')]],
  ['a1', [draft('tgt-2', 'added', 'add|a1|tgt-2')]],
  ['r1', [draft('tgt-3', 'removed')]],
  // u1 has no draft → an unmatched row with a Link action.
]);

describe('direct relationship row actions', () => {
  it('renders each draft status with its badge and resolved label', () => {
    renderPreview(makeControls(), drafts);
    expect(screen.getByText('direct')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('removing')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
  });

  it('buffers removal of a persisted direct edge', async () => {
    const controls = makeControls();
    renderPreview(controls, drafts);

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove direct relationship' }),
    );
    expect(controls.onRemove).toHaveBeenCalledWith('k-tgt-1');
  });

  it('undoes a pending addition', async () => {
    const controls = makeControls();
    renderPreview(controls, drafts);

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Discard pending direct relationship',
      }),
    );
    expect(controls.onUndo).toHaveBeenCalledWith('add|a1|tgt-2');
  });

  it('undoes a pending removal', async () => {
    const controls = makeControls();
    renderPreview(controls, drafts);

    await userEvent.click(
      screen.getByRole('button', { name: 'Keep direct relationship' }),
    );
    expect(controls.onUndo).toHaveBeenCalledWith('k-tgt-3');
  });

  it('links an unmatched source via the picker popover', async () => {
    const controls = makeControls();
    renderPreview(controls, drafts);

    const linkButtons = screen.getAllByRole('button', { name: /Link/ });
    expect(linkButtons).toHaveLength(1);

    await userEvent.click(linkButtons[0]);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Pick tgt-9' }),
    );
    expect(controls.onLink).toHaveBeenCalledWith('u1', 'tgt-9');
  });

  it('disables the actions while a flush is in flight', () => {
    renderPreview(makeControls({ mutating: true }), drafts);
    expect(
      screen.getByRole('button', { name: 'Remove direct relationship' }),
    ).toBeDisabled();
  });
});
