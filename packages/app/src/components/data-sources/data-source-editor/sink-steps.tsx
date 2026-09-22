import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Database } from 'lucide-react';
import type { JsonValue } from '../../../types';
import {
  deriveOutputSchema,
  autoFixSchema,
} from '@roadiehq/catalog-datastore-common';
import {
  FALLBACK_ID_FIELDS,
  type DuplicateObjectIdStrategy,
  parseDuplicateObjectIdStrategy,
} from '../../../api/workflow/workflow-client';
import { OutlinedSelect } from '@roadiehq/ui/outlined-select';
import { SelectItem } from '@roadiehq/ui/select';
import { JsonataFieldSelect } from './jsonata-field-select';
import { StepNode, FlowConnector, edgeState } from './step-components';
import type { StepStatus, FlowConnectorState } from './step-components';
import type { SinkStep } from '../types';
import { SchemaCorrectionsDisplay } from './schema-corrections-display';
import { useDataSourceEditorContext } from './data-source-editor-context';
import { useSourceSchema } from '../use-source-schema';

interface SinkNodeConfig {
  icon: React.ReactNode;
  title: string;
}

const SINK_CONFIG: Record<SinkStep['type'], SinkNodeConfig> = {
  datastore: {
    icon: <Database className="size-5" />,
    title: 'Store',
  },
  ['entity-provider']: {
    icon: <Database className="size-5" />,
    title: 'Store',
  },
};

const COLLISION_STRATEGY_OPTIONS: {
  value: DuplicateObjectIdStrategy;
  label: string;
}[] = [
  {
    value: 'fail',
    label: 'Fail (default)',
  },
  {
    value: 'keep_last',
    label: 'Keep one (one item wins, others are dropped)',
  },
  {
    value: 'append',
    label: 'Append (keep first row; extra duplicates under additionalResults)',
  },
  {
    value: 'expand',
    label:
      'Keep all (keep all duplicates separately using a compound object id)',
  },
];

interface SinkStepRowProps {
  handleUpdateSink: (id: string, field: string, value: unknown) => void;
  handleDeleteSink: (id: string) => void;
  canDelete: boolean;
  showLeadingConnector: boolean;
  leadingConnectorState: FlowConnectorState;
  handleStepClick: (stepId: string, shiftKey: boolean) => void;
  expanded: boolean;
  selected: boolean;
  sinkInput: unknown[] | undefined;
  sink: SinkStep;
  sinkOutput: unknown[];
  sinkError: string;
  running: boolean;
  onConfirmSchema: (sinkId: string, schema: JsonValue) => void;
  confirmedSchema: JsonValue | null;
  sourceOutput: unknown[] | undefined;
  sourceSchema: JsonValue | null;
}

function SinkStepRow(props: SinkStepRowProps) {
  const {
    sink,
    running,
    sinkOutput,
    sinkError,
    expanded,
    selected,
    sinkInput,
    handleStepClick,
    handleDeleteSink,
    canDelete,
    showLeadingConnector,
    leadingConnectorState,
    handleUpdateSink,
    onConfirmSchema,
    confirmedSchema,
    sourceOutput,
    sourceSchema,
  } = props;
  const config = SINK_CONFIG[sink.type];
  const hasSinkRun = Array.isArray(sinkOutput);
  const [correctionsAccepted, setCorrectionsAccepted] = useState(false);

  useEffect(() => {
    setCorrectionsAccepted(false);
  }, [sinkInput]);

  const derivedSchema = useMemo(() => {
    if (!sinkInput || sinkInput.length === 0) {
      return sourceSchema ?? null;
    }
    const upstreamData =
      sourceOutput && sourceOutput.length > 0 ? sourceOutput : sinkInput;
    return deriveOutputSchema(
      sourceSchema,
      upstreamData as JsonValue[],
      sinkInput as JsonValue[],
    );
  }, [sinkInput, sourceOutput, sourceSchema]);

  const effectiveIdSelector = useMemo(() => {
    const configured = sink.config.id_selector as string | undefined;
    if (configured) {
      return configured;
    }
    if (
      !derivedSchema ||
      typeof derivedSchema !== 'object' ||
      Array.isArray(derivedSchema)
    ) {
      return '';
    }
    const schema = derivedSchema as Record<string, unknown>;
    if (schema.type !== 'object' || !schema.properties) {
      return '';
    }
    const schemaProps = schema.properties as Record<string, { type?: string }>;
    const propsByField = new Map(Object.entries(schemaProps));
    for (const field of FALLBACK_ID_FIELDS) {
      const prop = propsByField.get(field);
      if (!prop) {
        continue;
      }
      if (prop.type === 'string') {
        return `$.${field}`;
      }
      if (prop.type === 'integer' || prop.type === 'number') {
        return `$string($.${field})`;
      }
    }
    return '';
  }, [sink.config.id_selector, derivedSchema]);

  const schemaFixResult = useMemo(() => {
    if (!confirmedSchema || !sinkInput || sinkInput.length === 0) {
      return null;
    }
    const result = autoFixSchema(sinkInput as JsonValue[], confirmedSchema);
    return result.corrections.length > 0 ? result : null;
  }, [confirmedSchema, sinkInput]);

  const handleAcceptCorrections = useCallback(() => {
    if (!schemaFixResult) {
      return;
    }
    onConfirmSchema(sink.id, schemaFixResult.fixedSchema);
    setCorrectionsAccepted(true);
  }, [schemaFixResult, onConfirmSchema, sink.id]);

  const isValidIdSelector = useCallback(
    (value: unknown) => typeof value === 'string' && value.length > 0,
    [],
  );
  const isOptionalStringSelector = useCallback(
    (value: unknown) =>
      value === undefined || value === '' || typeof value === 'string',
    [],
  );

  const getSinkStatus = (): StepStatus => {
    if (sinkError) {
      return 'error';
    }
    if (running) {
      return 'running';
    }
    if (schemaFixResult && !correctionsAccepted) {
      return 'warning';
    }
    if (hasSinkRun) {
      return 'success';
    }
    return 'configured';
  };

  const getSinkSubtitle = (): string | undefined => {
    if (sinkError) {
      return 'Execution failed';
    }
    if (running) {
      return 'Processing...';
    }
    if (schemaFixResult && !correctionsAccepted) {
      return 'Schema corrections available';
    }
    if (hasSinkRun) {
      const written = sinkOutput.length;
      const itemLabel = written === 1 ? 'item' : 'items';
      return `Last run: ${written} ${itemLabel} written to the datastore`;
    }
    if (sinkInput && sinkInput.length > 0) {
      return `${sinkInput.length} row${sinkInput.length !== 1 ? 's' : ''} from pipeline — run to sync`;
    }
    return undefined;
  };

  const collisionStrategy = parseDuplicateObjectIdStrategy(
    sink.config.duplicate_object_id_strategy,
  );

  return (
    <>
      {showLeadingConnector && <FlowConnector state={leadingConnectorState} />}
      <StepNode
        icon={config.icon}
        title={config.title}
        subtitle={getSinkSubtitle()}
        status={getSinkStatus()}
        variant="sink"
        expanded={expanded}
        selected={selected}
        onToggle={opts => handleStepClick(sink.id, opts?.shiftKey ?? false)}
        onDelete={canDelete ? () => handleDeleteSink(sink.id) : undefined}
      >
        <div className="flex flex-col gap-4">
          {schemaFixResult && (
            <SchemaCorrectionsDisplay
              corrections={schemaFixResult.corrections}
              onAccept={handleAcceptCorrections}
              accepted={correctionsAccepted}
            />
          )}
          <div>
            <JsonataFieldSelect
              data={sinkInput}
              schemaData={derivedSchema}
              value={effectiveIdSelector}
              label="Unique Index"
              helperText={`JSONata expression used as the datastore object id (may repeat across rows if you dedupe to one row per index). For unique keys per row, combine fields, e.g. $string(_parent.id) & "-" & $string($.id).`}
              valid={isValidIdSelector}
              outputType="string"
              allowDuplicateSampleValues
              onChange={e =>
                handleUpdateSink(sink.id, 'id_selector', e.target.value)
              }
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <JsonataFieldSelect
              data={sinkInput}
              schemaData={derivedSchema}
              value={(sink.config.presentation_title_selector as string) ?? ''}
              label="Object title"
              helperText="Optional JSONata expression used as the primary object label."
              valid={isOptionalStringSelector}
              outputType="string"
              onChange={e =>
                handleUpdateSink(
                  sink.id,
                  'presentation_title_selector',
                  e.target.value,
                )
              }
            />
            <JsonataFieldSelect
              data={sinkInput}
              schemaData={derivedSchema}
              value={
                (sink.config.presentation_subtitle_selector as string) ?? ''
              }
              label="Object subtitle"
              helperText="Optional JSONata expression shown below the title."
              valid={isOptionalStringSelector}
              outputType="string"
              onChange={e =>
                handleUpdateSink(
                  sink.id,
                  'presentation_subtitle_selector',
                  e.target.value,
                )
              }
            />
            <JsonataFieldSelect
              data={sinkInput}
              schemaData={derivedSchema}
              value={(sink.config.presentation_image_selector as string) ?? ''}
              label="Object image"
              helperText="Optional JSONata expression that resolves to an image URL."
              valid={isOptionalStringSelector}
              outputType="string"
              onChange={e =>
                handleUpdateSink(
                  sink.id,
                  'presentation_image_selector',
                  e.target.value,
                )
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <OutlinedSelect
              label="When index values collide"
              value={collisionStrategy}
              onValueChange={value =>
                handleUpdateSink(
                  sink.id,
                  'duplicate_object_id_strategy',
                  value as DuplicateObjectIdStrategy,
                )
              }
            >
              {COLLISION_STRATEGY_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </OutlinedSelect>
            <p className="text-xs text-muted-foreground">
              Keep one drops duplicate index values; the last row in the batch
              wins. Append keeps the first row per index and stores later
              duplicates in additionalResults. Expand gives each row a
              disambiguated object id. Default is to fail on duplicates.
            </p>
          </div>
        </div>
      </StepNode>
    </>
  );
}

export function SinkSteps() {
  const {
    sinks,
    nodeOutputs,
    nodeErrors,
    runningNodes,
    expandedStep,
    selectedSteps,
    handleStepClick,
    finalOutput,
    sourceOutput,
    handleUpdateSink,
    handleDeleteSink,
    confirmedSinkSchema,
    setConfirmedSinkSchema,
    sourceType,
    sourceConfig,
    sourceSchemaVersion,
    accumulatedSchema,
    workflowApi,
  } = useDataSourceEditorContext();

  const sourceSchema = useSourceSchema(
    workflowApi,
    sourceType,
    sourceConfig,
    sourceSchemaVersion,
  );
  const effectiveSchema = accumulatedSchema ?? sourceSchema;

  const handleConfirmSchema = useCallback(
    (sinkId: string, schema: JsonValue) => {
      setConfirmedSinkSchema(prev => ({ ...prev, [sinkId]: schema }));
      handleUpdateSink(sinkId, 'schema', schema);
    },
    [handleUpdateSink, setConfirmedSinkSchema],
  );

  if (sinks.length === 0) {
    return null;
  }

  return (
    <>
      {sinks.map((sink, index) => (
        <SinkStepRow
          canDelete={sinks.length > 1}
          handleStepClick={handleStepClick}
          expanded={expandedStep === sink.id}
          selected={selectedSteps.includes(sink.id)}
          key={sink.id}
          sink={sink}
          showLeadingConnector={index > 0}
          leadingConnectorState={
            index > 0
              ? edgeState(
                  sinks[index - 1].id,
                  sink.id,
                  runningNodes,
                  nodeOutputs,
                )
              : 'idle'
          }
          sinkInput={finalOutput}
          sinkOutput={nodeOutputs[sink.id]}
          sinkError={nodeErrors[sink.id]}
          running={runningNodes.has(sink.id)}
          onConfirmSchema={handleConfirmSchema}
          handleDeleteSink={handleDeleteSink}
          handleUpdateSink={handleUpdateSink}
          confirmedSchema={confirmedSinkSchema[sink.id] ?? null}
          sourceOutput={sourceOutput}
          sourceSchema={effectiveSchema}
        />
      ))}
    </>
  );
}
