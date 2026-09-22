import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import { Spinner } from '@roadiehq/ui/spinner';
import { OutlinedTextarea } from '@roadiehq/ui/outlined-textarea';
import { RotateCcw, SlidersHorizontal, Zap } from 'lucide-react';
import { IntegrationLogo } from '@roadiehq/ui/item-list';
import type { StepStatus } from '@roadiehq/ui/step-flow';
import { DetailHeaderBlock, type StepInfo } from '../../common/pipeline-editor';
import { JsonTreeView } from '../../common/json-tree-view';
import { useLogoResolver } from '../../data-sources/use-resolved-logo';
import type { Integration } from '../../integrations/types';
import type { ActionStep, ExecuteResult, StepResult } from '../types';

const ICON_SIZE = 16;

/**
 * Sentinel breadcrumb id for the leading Inputs step (mirrors the DS trigger).
 * The leading `:` can never collide with a user step id — those must match
 * isValidStepId (`^[A-Za-z_][A-Za-z0-9_]*$`).
 */
export const INPUTS_STEP_ID = ':inputs';

function stepStatus(
  executed: StepResult | undefined,
  running: boolean,
): StepStatus {
  if (executed) return executed.ok ? 'success' : 'error';
  return running ? 'running' : 'pending';
}

/**
 * The Inputs step: the editable JSON test-input values the header Test button
 * runs with. Fill in parameter values here before Test; the panel itself
 * opens on the first request step.
 */
function InputsEditor({
  inputText,
  onInputTextChange,
  onResetInputs,
  validationError,
  disabled,
}: {
  inputText: string;
  onInputTextChange: (value: string) => void;
  onResetInputs: () => void;
  validationError: string | null;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          Test inputs (JSON)
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onResetInputs}
          disabled={disabled}
        >
          <RotateCcw className="size-4" />
          Reset
        </Button>
      </div>
      <OutlinedTextarea
        label="Inputs (JSON)"
        value={inputText}
        disabled={disabled}
        className="min-h-[160px] font-mono text-xs"
        onChange={e => onInputTextChange(e.target.value)}
      />
      {validationError && (
        <p className="text-xs text-destructive">{validationError}</p>
      )}
      <p className="text-xs text-muted-foreground">
        Values passed to the action when you press Test. Reference them in steps
        with <code>{'{{name}}'}</code>.
      </p>
    </div>
  );
}

function StepResponse({ result }: { result: StepResult }) {
  const payload = result.ok ? result.data : result.error;
  const isStructured = typeof payload === 'object' && payload !== null;
  return (
    <div className="space-y-2">
      <Badge
        variant={result.ok ? 'success' : 'destructive'}
        className="font-mono"
      >
        HTTP {result.status}
      </Badge>
      {isStructured ? (
        <JsonTreeView value={payload} maxHeight={480} />
      ) : (
        <pre className="max-h-[480px] overflow-auto rounded bg-muted p-3 font-mono text-xs">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

/**
 * Details-panel content for actions. Mirrors the data-source editor's
 * NodeDetailsPanel: the shared step breadcrumb (DetailHeaderBlock) on top, then
 * the selected step's pane below. The leading Inputs step is an editable
 * test-input form; request steps show run responses and are the default
 * selection.
 */
export function ActionRunPanel({
  steps,
  integrations,
  inputText,
  onInputTextChange,
  onResetInputs,
  validationError,
  disabled,
  result,
  running,
  selectedStepId,
  onSelectStep,
}: {
  steps: ActionStep[];
  integrations: Integration[];
  inputText: string;
  onInputTextChange: (value: string) => void;
  onResetInputs: () => void;
  validationError: string | null;
  disabled?: boolean;
  result: ExecuteResult | null;
  running: boolean;
  selectedStepId: string | null;
  onSelectStep: (id: string) => void;
}) {
  const resolveLogo = useLogoResolver();
  const executedById = new Map((result?.steps ?? []).map(s => [s.id, s]));

  const inputsInfo: StepInfo = {
    id: INPUTS_STEP_ID,
    name: 'Inputs',
    variant: 'source',
    icon: <SlidersHorizontal className="size-4 text-primary" />,
    status: 'configured',
  };

  const stepsInfo: StepInfo[] = [
    inputsInfo,
    ...steps.map(step => {
      const integration = integrations.find(i => i.id === step.integrationId);
      return {
        id: step.id,
        name: step.id,
        variant: 'source' as const,
        icon: integration ? (
          <IntegrationLogo src={resolveLogo(integration)} size={ICON_SIZE} />
        ) : (
          <Zap className="size-4 text-primary" />
        ),
        status: stepStatus(executedById.get(step.id), running),
      };
    }),
  ];

  const selected = selectedStepId
    ? executedById.get(selectedStepId)
    : undefined;

  function renderContent() {
    if (selectedStepId === INPUTS_STEP_ID) {
      return (
        <InputsEditor
          inputText={inputText}
          onInputTextChange={onInputTextChange}
          onResetInputs={onResetInputs}
          validationError={validationError}
          disabled={disabled}
        />
      );
    }
    if (running && !result) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size={16} />
          Running…
        </div>
      );
    }
    if (!result) {
      return (
        <p className="text-sm text-muted-foreground">
          Run the action to see per-step responses here.
        </p>
      );
    }
    if (selected) {
      return <StepResponse result={selected} />;
    }
    return (
      <p className="text-sm text-muted-foreground">
        {result.ok
          ? 'Select a step to inspect its response.'
          : 'This step did not run — an earlier step failed and halted the run.'}
      </p>
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col">
        <DetailHeaderBlock
          steps={stepsInfo}
          selectedSteps={selectedStepId ? [selectedStepId] : []}
          onStepClick={id => onSelectStep(id)}
        />

        <div className="min-h-0 flex-1 overflow-auto px-3 py-4">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
