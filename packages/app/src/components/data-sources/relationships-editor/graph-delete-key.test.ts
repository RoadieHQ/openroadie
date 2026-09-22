import { describe, expect, it } from 'vitest';
import {
  resolveDeleteKeyAction,
  type DeleteKeyContext,
} from './graph-delete-key';

function context(overrides: Partial<DeleteKeyContext> = {}): DeleteKeyContext {
  return {
    key: 'Backspace',
    targetTagName: 'DIV',
    targetIsEditable: false,
    keyboardBlocked: false,
    isEdit: true,
    selectedRuleId: null,
    focusedNodeId: null,
    canDeleteDataSource: true,
    ...overrides,
  };
}

describe('resolveDeleteKeyAction', () => {
  it('deletes the selected rule', () => {
    expect(
      resolveDeleteKeyAction(context({ selectedRuleId: 'rule-1' })),
    ).toEqual({ kind: 'delete-rule', ruleId: 'rule-1' });
  });

  it('deletes the focused data source when no rule is selected', () => {
    expect(
      resolveDeleteKeyAction(context({ focusedNodeId: 'workflow-ds-1' })),
    ).toEqual({ kind: 'delete-datasource', nodeId: 'workflow-ds-1' });
  });

  it('prefers the selected rule over the focused data source', () => {
    expect(
      resolveDeleteKeyAction(
        context({ selectedRuleId: 'rule-1', focusedNodeId: 'workflow-ds-1' }),
      ),
    ).toEqual({ kind: 'delete-rule', ruleId: 'rule-1' });
  });

  it('accepts Delete as well as Backspace', () => {
    expect(
      resolveDeleteKeyAction(
        context({ key: 'Delete', selectedRuleId: 'rule-1' }),
      ),
    ).toEqual({ kind: 'delete-rule', ruleId: 'rule-1' });
  });

  it('ignores every other key', () => {
    expect(
      resolveDeleteKeyAction(context({ key: 'a', selectedRuleId: 'rule-1' })),
    ).toEqual({ kind: 'none' });
  });

  // The bug this resolver exists to prevent: Backspace with a confirmation
  // dialog open (focus on one of its buttons, so not an input) started a
  // second delete of the still-selected rule.
  it('does nothing while a dialog or inspector owns the keyboard', () => {
    expect(
      resolveDeleteKeyAction(
        context({ keyboardBlocked: true, selectedRuleId: 'rule-1' }),
      ),
    ).toEqual({ kind: 'none' });
  });

  it.each(['INPUT', 'TEXTAREA', 'SELECT'])(
    'does nothing while typing in a %s',
    targetTagName => {
      expect(
        resolveDeleteKeyAction(
          context({ targetTagName, selectedRuleId: 'rule-1' }),
        ),
      ).toEqual({ kind: 'none' });
    },
  );

  it('does nothing inside a contenteditable element', () => {
    expect(
      resolveDeleteKeyAction(
        context({ targetIsEditable: true, selectedRuleId: 'rule-1' }),
      ),
    ).toEqual({ kind: 'none' });
  });

  it('does nothing outside Edit mode', () => {
    expect(
      resolveDeleteKeyAction(
        context({ isEdit: false, selectedRuleId: 'rule-1' }),
      ),
    ).toEqual({ kind: 'none' });
  });

  it('does not offer data-source deletion when the caller cannot delete', () => {
    expect(
      resolveDeleteKeyAction(
        context({ focusedNodeId: 'workflow-ds-1', canDeleteDataSource: false }),
      ),
    ).toEqual({ kind: 'none' });
  });

  it('does nothing when nothing is selected or focused', () => {
    expect(resolveDeleteKeyAction(context())).toEqual({ kind: 'none' });
  });
});
