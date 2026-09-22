import { render, screen } from '@testing-library/react';
import { RelationshipEditorActions } from './relationship-editor-actions';

function renderActions(props: Partial<{ deleteLabel: string }> = {}) {
  render(
    <RelationshipEditorActions
      isEdit
      createLabel="Create"
      canSave
      busy={false}
      saving={false}
      deleting={false}
      onSave={() => {}}
      onDelete={() => {}}
      {...props}
    />,
  );
}

describe('RelationshipEditorActions', () => {
  it('labels the destructive action Delete by default', () => {
    renderActions();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('lets the caller name the destructive action', () => {
    // Suggestion reviewers dismiss (the rule survives as inactive) rather than
    // delete, so the control must not promise a deletion.
    renderActions({ deleteLabel: 'Dismiss' });
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
