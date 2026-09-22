import { SlidersHorizontal } from 'lucide-react';
import { StepNode } from '@roadiehq/ui/step-flow';
import { ParameterBuilder } from './parameter-builder';
import type { ActionParam } from '../types';

/**
 * The leading node of the actions canvas — the "what goes in" slot (mirroring
 * the data-source editor's trigger). Declares the typed input parameters; the
 * JSON test-input values live in the details panel's Inputs step, not here.
 */
export function ActionInputsNode({
  parameters,
  onParametersChange,
  disabled,
  expanded,
  onToggle,
  error,
}: {
  parameters: ActionParam[];
  onParametersChange: (parameters: ActionParam[]) => void;
  disabled?: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Save-time parameter validation message from the editor schema. */
  error?: string;
}) {
  const count = parameters.length;
  return (
    <StepNode
      testId="action-inputs-node"
      icon={<SlidersHorizontal className="size-5 text-primary" />}
      title="Inputs"
      subtitle={
        count > 0
          ? `${count} parameter${count !== 1 ? 's' : ''}`
          : 'No parameters'
      }
      status="configured"
      variant="trigger"
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">
          Parameters — template into requests with <code>{'{{name}}'}</code>
        </p>
        <ParameterBuilder
          value={parameters}
          disabled={disabled}
          onChange={onParametersChange}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </StepNode>
  );
}
