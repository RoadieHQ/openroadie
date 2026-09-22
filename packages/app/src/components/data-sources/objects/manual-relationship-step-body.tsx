import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Waypoints } from 'lucide-react';
import { motionTransitions } from '@roadiehq/ui/motion';
import { IntegrationLogo } from '@roadiehq/ui/item-list';
import { useDatastore } from '../../../api';
import { objectDetailQuery } from '../../../api/queries';
import type { DataSourceItem } from '../types';
import {
  StepMapChrome,
  type MapSegment,
} from '../relationships-editor/step-map';
import {
  ChainCard,
  PreviewState,
} from '../relationships-editor/step-chain-card';
import { ObjectPropertyTree } from '../relationships-editor/object-property-tree';
import { RelationshipTypeField } from '../relationships-editor/rule-fields';
import { ReciprocalField } from '../relationships-editor/reciprocal-field';
import {
  StepCogButton,
  StepColumnShell,
} from '../relationships-editor/step-column-shell';
import { DataSourcePicker } from '../data-source-picker';
import { ObjectListPicker } from './object-list-picker';
import {
  DUPLICATE_RELATIONSHIP_MESSAGE,
  type ManualRelationshipEditorState,
} from './use-manual-relationship-editor';

type ManualRole = 'source' | 'match' | 'target' | 'target-object';

export interface ManualRelationshipStepBodyProps {
  editor: ManualRelationshipEditorState;
  /** Display name of the (fixed) source object, shown on the Source node. */
  sourceLabel: string;
  sourceDatasourceId: string;
  sourceObjectId: string;
  dataSources: DataSourceItem[];
}

/**
 * The manual relationship editor body, in the same step-map + column language as
 * the rule editor (reusing its `StepMapChrome`, `StepColumnShell`, pills and
 * cogwheels): a clickable Source → Match → Target → Target object map above four
 * stage panels. The source object is fixed; the Match panel names the
 * relationship, the Target panel configures the data source and lists its
 * objects to pick from, and the Target object panel shows the chosen object.
 */
export function ManualRelationshipStepBody({
  editor,
  sourceLabel,
  sourceDatasourceId,
  sourceObjectId,
  dataSources,
}: ManualRelationshipStepBodyProps) {
  const api = useDatastore();
  const pipelineId = useId();
  const prefersReducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(true);
  // Both open on their configuration first (the verb, the data source); the
  // Target flips to its object list once a data source is chosen.
  const [matchConfigOpen, setMatchConfigOpen] = useState(true);
  const [targetConfigOpen, setTargetConfigOpen] = useState(true);

  const dsMeta = useMemo(() => {
    const names = new Map(dataSources.map(ds => [ds.id, ds.name]));
    const logos = new Map(dataSources.map(ds => [ds.id, ds.logoUrl]));
    return {
      name: (id: string) => names.get(id) ?? id,
      logo: (id: string) => logos.get(id) ?? '',
    };
  }, [dataSources]);

  const sourceQuery = useQuery(
    objectDetailQuery(api, sourceDatasourceId, sourceObjectId),
  );

  const relationshipType = editor.typeState.relationshipType.trim();
  const reciprocal = editor.typeState.reciprocalRelationshipType.trim();
  // Resolved by the editor hook (shared with the drawer header endpoint).
  const targetDisplayName = editor.targetObjectId
    ? editor.targetLabel || editor.targetObjectId
    : 'Target object';

  // Match the rule editor's step map: the bold title is the generic step name and
  // the concrete entity (object · data source) rides the subtitle. The Match node
  // keeps the verb as its title — the rule editor's edge segment is verb-first too.
  const segments: MapSegment<ManualRole>[] = [
    {
      kind: 'node',
      role: 'source',
      title: 'Source',
      subtitle: `${sourceLabel} · ${dsMeta.name(sourceDatasourceId)}`,
      icon: <IntegrationLogo src={dsMeta.logo(sourceDatasourceId)} size={20} />,
      present: true,
    },
    {
      kind: 'node',
      role: 'match',
      title: relationshipType || 'Match',
      subtitle: reciprocal || undefined,
      icon: <Waypoints className="size-4 text-muted-foreground" />,
      present: !!relationshipType,
    },
    {
      kind: 'node',
      role: 'target',
      title: 'Target data source',
      subtitle: editor.targetDatasourceId
        ? dsMeta.name(editor.targetDatasourceId)
        : undefined,
      icon: (
        <IntegrationLogo
          src={
            editor.targetDatasourceId
              ? dsMeta.logo(editor.targetDatasourceId)
              : ''
          }
          size={20}
        />
      ),
      present: !!editor.targetDatasourceId,
    },
    {
      kind: 'node',
      role: 'target-object',
      title: 'Target object',
      subtitle: editor.targetObjectId
        ? `${targetDisplayName} · ${dsMeta.name(editor.targetDatasourceId)}`
        : undefined,
      icon: (
        <IntegrationLogo
          src={
            editor.targetDatasourceId
              ? dsMeta.logo(editor.targetDatasourceId)
              : ''
          }
          size={20}
        />
      ),
      present: !!editor.targetObjectId,
    },
  ];

  const activeRoles = new Set<ManualRole>([
    ...(matchConfigOpen ? (['match'] as const) : []),
    ...(targetConfigOpen ? (['target'] as const) : []),
  ]);

  const onNodeClick = (role: ManualRole) => {
    setExpanded(true);
    if (role === 'match') {
      setMatchConfigOpen(v => !v);
    } else if (role === 'target') {
      setTargetConfigOpen(v => !v);
    }
  };

  // Incomplete stages flag on the cogwheel (a warning dot) rather than a wide
  // header pill, so the narrow columns stay uncluttered — matching how the rule
  // editor's columns surface "needs attention" on the cog.
  const warn = (label: string) => ({ className: 'bg-warning', label });
  const matchDot = relationshipType ? null : warn('Pick a relationship type');
  // The Target panel is about the data source; its dot flags a missing source.
  // Object selection happens in the panel's object list, not via a dot.
  const targetDot = editor.targetDatasourceId
    ? null
    : warn('Pick a data source');

  return (
    <div className="flex flex-col gap-4">
      <StepMapChrome<ManualRole>
        segments={segments}
        expanded={expanded}
        onToggleExpanded={() => setExpanded(e => !e)}
        pipelineId={pipelineId}
        activeRoles={activeRoles}
        onNodeClick={onNodeClick}
      />

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            id={pipelineId}
            key="pipeline"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              prefersReducedMotion
                ? motionTransitions.instant
                : motionTransitions.sidebarDisclosure
            }
            className="overflow-hidden"
          >
            <div className="flex h-80 items-stretch gap-3 overflow-x-auto">
              <StepColumnShell
                label="Source"
                panelOpen={false}
                className="min-w-[13rem] flex-1"
                preview={
                  <ChainCard>
                    <PreviewState
                      loading={sourceQuery.isLoading}
                      error={sourceQuery.error}
                    >
                      <ObjectPropertyTree value={sourceQuery.data?.object} />
                    </PreviewState>
                  </ChainCard>
                }
              />

              <StepColumnShell
                label={matchConfigOpen ? 'Match — Configuration' : 'Match'}
                panelOpen={matchConfigOpen}
                className={
                  matchConfigOpen ? 'min-w-[18rem] flex-1' : 'w-32 shrink-0'
                }
                actions={
                  <StepCogButton
                    active={matchConfigOpen}
                    activeLabel="Show match summary"
                    inactiveLabel="Configure match"
                    dot={matchDot}
                    onClick={() => setMatchConfigOpen(v => !v)}
                  />
                }
                panel={
                  <div className="flex min-w-0 flex-col gap-4">
                    <RelationshipTypeField
                      editor={editor.typeState}
                      duplicateMessage={DUPLICATE_RELATIONSHIP_MESSAGE}
                    />
                    <ReciprocalField
                      editor={editor.typeState}
                      duplicateMessage={DUPLICATE_RELATIONSHIP_MESSAGE}
                    />
                  </div>
                }
                preview={
                  <ChainCard>
                    <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
                      <span className="max-w-full truncate text-sm font-semibold text-foreground">
                        {relationshipType || 'Match'}
                      </span>
                      {reciprocal && (
                        <span className="max-w-full truncate text-2xs text-muted-foreground">
                          reverse: {reciprocal}
                        </span>
                      )}
                    </div>
                  </ChainCard>
                }
              />

              <StepColumnShell
                label={
                  targetConfigOpen
                    ? 'Target data source — Configuration'
                    : 'Target data source'
                }
                panelOpen={targetConfigOpen}
                className="min-w-[15rem] flex-1"
                actions={
                  <StepCogButton
                    active={targetConfigOpen}
                    activeLabel="Show target objects"
                    inactiveLabel="Configure target data source"
                    dot={targetDot}
                    onClick={() => setTargetConfigOpen(v => !v)}
                  />
                }
                panel={
                  <DataSourcePicker
                    label="Target data source"
                    ariaLabel="Target data source"
                    dataSources={dataSources}
                    value={editor.targetDatasourceId}
                    onChange={id => {
                      editor.setTargetDatasourceId(id);
                      // Flip to the object list so the user picks the object next;
                      // the cogwheel brings the data-source config back.
                      setTargetConfigOpen(false);
                    }}
                    placeholder="Select data source"
                  />
                }
                preview={
                  editor.targetDatasourceId ? (
                    <ObjectListPicker
                      fill
                      label="Target object"
                      datasourceId={editor.targetDatasourceId}
                      objectId={editor.targetObjectId}
                      onObjectIdChange={editor.setTargetObjectId}
                    />
                  ) : (
                    <ChainCard>
                      <PreviewState emptyText="Select a data source to list its objects." />
                    </ChainCard>
                  )
                }
              />

              <StepColumnShell
                label="Target object"
                panelOpen={false}
                className="min-w-[14rem] flex-1"
                preview={
                  <ChainCard>
                    <PreviewState
                      loading={
                        editor.targetObjectLoading && !!editor.targetObjectId
                      }
                      error={
                        editor.targetObjectId
                          ? editor.targetObjectError
                          : undefined
                      }
                      emptyText={
                        editor.targetObjectId
                          ? undefined
                          : 'Pick a target object.'
                      }
                    >
                      <ObjectPropertyTree value={editor.targetObject?.object} />
                    </PreviewState>
                  </ChainCard>
                }
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {editor.saveError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {editor.saveError}
        </p>
      )}
    </div>
  );
}
