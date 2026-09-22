import { useMemo } from 'react';
import { objectDetail } from '../../../config/paths';
import type { ObjectRelationship } from '../../../api/datastore/datastore-client';
import type { DataSourceItem } from '../types';
import { RelationshipEditorShell } from '../relationships-editor/relationship-editor-shell';
import { RelationshipEditorActions } from '../relationships-editor/relationship-editor-actions';
import { editorGateActionProps } from '../relationships-editor/relationship-editor-gate';
import { ManualRelationshipStepBody } from './manual-relationship-step-body';
import {
  useManualRelationshipEditor,
  type ManualRelationshipEditorState,
} from './use-manual-relationship-editor';

export interface ManualRelationshipEditorProps {
  variant?: 'drawer' | 'page';
  open: boolean;
  /** Portal target for the drawer variant. */
  container?: HTMLElement | null;
  /** The object the edge originates from (fixed). */
  sourceDatasourceId: string;
  sourceObjectId: string;
  /** Display name of the source object, shown in the header endpoint. */
  sourceLabel: string;
  dataSources: DataSourceItem[];
  existingRelationships?: ObjectRelationship[];
  /** An existing outgoing manual relationship to edit; omit to create. */
  relationship?: ObjectRelationship;
  onClose: () => void;
  onSaved: (workspaceScopeKey: string) => void | Promise<void>;
  showHeader?: boolean;
  standaloneHref?: string;
  /**
   * Externally-owned editor state, so a full-page composition can hoist the
   * action cluster into its own page header (mirrors the rule inspector). When
   * omitted, the editor owns its state.
   */
  editor?: ManualRelationshipEditorState;
}

/** The save / delete / cancel cluster; shared by the drawer header and the page header. */
export function ManualRelationshipActions({
  editor,
  onClose,
}: {
  editor: ManualRelationshipEditorState;
  onClose: () => void;
}) {
  return (
    <RelationshipEditorActions
      {...editorGateActionProps(editor)}
      createLabel="Create"
      onDelete={editor.handleDelete}
      onClose={onClose}
    />
  );
}

/**
 * Create or edit a manual one-off relationship, in the same two-endpoint shell
 * (drawer or full page) as the rule editor. The source endpoint is the object
 * the edge starts from; the body picks the target object and the relationship /
 * reverse verb using the controls shared with the rule editor.
 */
export function ManualRelationshipEditor(props: ManualRelationshipEditorProps) {
  if (props.editor) {
    return <ManualRelationshipEditorContent {...props} editor={props.editor} />;
  }
  return <ManualRelationshipEditorWithState {...props} />;
}

function ManualRelationshipEditorWithState(
  props: ManualRelationshipEditorProps,
) {
  const editor = useManualRelationshipEditor({
    sourceDatasourceId: props.sourceDatasourceId,
    sourceObjectId: props.sourceObjectId,
    existingRelationships: props.existingRelationships,
    relationship: props.relationship,
    onSaved: props.onSaved,
  });
  return <ManualRelationshipEditorContent {...props} editor={editor} />;
}

function ManualRelationshipEditorContent({
  variant = 'drawer',
  open,
  container,
  sourceDatasourceId,
  sourceObjectId,
  sourceLabel,
  dataSources,
  onClose,
  showHeader = true,
  standaloneHref,
  editor,
}: ManualRelationshipEditorProps & { editor: ManualRelationshipEditorState }) {
  const logoFor = useMemo(() => {
    const map = new Map(dataSources.map(ds => [ds.id, ds.logoUrl]));
    return (id: string) => map.get(id);
  }, [dataSources]);

  const title = editor.isEdit
    ? 'Edit direct relationship'
    : 'New direct relationship';

  return (
    <RelationshipEditorShell
      variant={variant}
      open={open}
      container={container}
      title={title}
      source={{
        label: sourceLabel,
        logoUrl: logoFor(sourceDatasourceId),
        href: objectDetail(sourceDatasourceId, sourceObjectId),
      }}
      target={{
        label: editor.targetLabel || 'Select target',
        logoUrl: editor.targetDatasourceId
          ? logoFor(editor.targetDatasourceId)
          : undefined,
        href:
          editor.targetDatasourceId && editor.targetObjectId
            ? objectDetail(editor.targetDatasourceId, editor.targetObjectId)
            : undefined,
      }}
      actions={<ManualRelationshipActions editor={editor} onClose={onClose} />}
      onClose={onClose}
      onSubmit={editor.handleSave}
      canSubmit={editor.canSave}
      busy={editor.busy}
      showHeader={showHeader}
      standaloneHref={standaloneHref}
      standaloneTitle="Open direct relationship editor in full page"
      drawerLabel="direct relationship drawer"
    >
      <ManualRelationshipStepBody
        editor={editor}
        sourceLabel={sourceLabel}
        sourceDatasourceId={sourceDatasourceId}
        sourceObjectId={sourceObjectId}
        dataSources={dataSources}
      />
    </RelationshipEditorShell>
  );
}
