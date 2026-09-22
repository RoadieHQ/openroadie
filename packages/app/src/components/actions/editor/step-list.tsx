import { useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Zap } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { OutlinedSelect } from '@roadiehq/ui/outlined-select';
import { SelectItem } from '@roadiehq/ui/select';
import {
  StepNode,
  type StepStatus,
  type FlowConnectorState,
} from '@roadiehq/ui/step-flow';
import { IntegrationLogo } from '@roadiehq/ui/item-list';
import { isValidStepId } from '@roadiehq/actions-common';
import type { Integration } from '../../integrations/types';
import { IntegrationSelector } from '../../common/integration-selector';
import { useLogoResolver } from '../../data-sources/use-resolved-logo';
import { InsertStepConnector } from '../../common/pipeline-editor';
import {
  HeadersEditor,
  JsonEditor,
  templateTolerantJsonLintSource,
} from '../../common/request-editor';
import type { ActionRequest, ActionStep, ExecuteResult } from '../types';
import {
  AwsServiceActionFields,
  makeAwsServiceActionRequest,
} from './aws-service-action-fields';

/** Monotonic render keys — step ids are user-editable, so they can't key the list. */
let keyCounter = 0;
const nextKey = () => `k${keyCounter++}`;

const HTTP_METHODS: ActionRequest['method'][] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
];

/** Methods that carry a request body; others hide the body template field. */
const METHODS_WITH_BODY: ActionRequest['method'][] = ['POST', 'PUT', 'PATCH'];

/** A fresh step with the first free `stepN` id. */
export function makeEmptyStep(existing: ActionStep[]): ActionStep {
  const ids = new Set(existing.map(s => s.id));
  let n = existing.length + 1;
  while (ids.has(`step${n}`)) n += 1;
  return {
    id: `step${n}`,
    integrationId: '',
    request: { method: 'GET', path: '', headers: [], body: '' },
  };
}

function stepStatus(
  step: ActionStep,
  running: boolean,
  runResult: ExecuteResult | null,
): StepStatus {
  if (running) return 'running';
  const executed = runResult?.steps?.find(r => r.id === step.id);
  if (executed) return executed.ok ? 'success' : 'error';
  if (runResult && !executed) return 'pending';
  const requestConfigured =
    step.request.backendType === 'aws'
      ? Boolean(
          step.request.profile.trim() &&
          step.request.region.trim() &&
          step.request.service.trim() &&
          step.request.path.trim(),
        )
      : Boolean(step.request.path.trim());
  return step.integrationId && requestConfigured ? 'configured' : 'pending';
}

function connectorState(
  downstream: ActionStep,
  running: boolean,
  runResult: ExecuteResult | null,
): FlowConnectorState {
  if (running) return 'flowing';
  // The connector into a step "completed" once that step actually executed.
  if (runResult?.steps?.some(r => r.id === downstream.id)) return 'completed';
  return 'idle';
}

export function StepList({
  steps,
  integrations,
  disabled,
  onChange,
  onIntegrationCreated,
  autoExpandFirstStep = false,
  editorResetKey,
  running = false,
  runResult = null,
}: {
  steps: ActionStep[];
  integrations: Integration[];
  disabled?: boolean;
  onChange: (steps: ActionStep[]) => void;
  /** Called when the selector creates an integration inline. */
  onIntegrationCreated: (integrationId: string) => void;
  /**
   * Expand the first step on mount. Latched — configuring a step never
   * auto-collapses it; only an explicit toggle does.
   */
  autoExpandFirstStep?: boolean;
  editorResetKey?: string | number;
  /** A test run is in flight — steps show as running, connectors flow. */
  running?: boolean;
  /** Last test-run envelope — executed steps show success/error borders. */
  runResult?: ExecuteResult | null;
}) {
  const resolveLogo = useLogoResolver();
  // Stable render keys parallel to `steps`; handlers keep them aligned across
  // add/move/remove. A length mismatch means the parent replaced the list
  // (e.g. seeding a loaded action) — reseed.
  const stepKeysRef = useRef<string[]>([]);
  if (stepKeysRef.current.length !== steps.length) {
    stepKeysRef.current = steps.map(nextKey);
  }
  const stepKeys = stepKeysRef.current;
  // Expansion is stateful (not derived from config) so selecting an integration
  // or typing a path never collapses the step being edited. Seeded once on
  // mount: the first request step opens so the editor lands on the work, not
  // the Inputs parameter list. (StepList remounts per action via the editor's
  // `key`, so the mount seed reflects the right action.)
  const [expanded, setExpandedRaw] = useState<Set<number>>(() =>
    autoExpandFirstStep && steps.length > 0 ? new Set([0]) : new Set<number>(),
  );

  const setExpanded = (update: (prev: Set<number>) => Set<number>) => {
    setExpandedRaw(prev => update(prev));
  };

  const toggle = (index: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const patchStep = (index: number, next: Partial<ActionStep>) => {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...next } : s)));
  };
  const patchRequest = (
    index: number,
    next: Partial<Pick<ActionRequest, 'method' | 'path' | 'headers' | 'body'>>,
  ) => {
    onChange(
      steps.map((s, i) =>
        i === index ? { ...s, request: { ...s.request, ...next } } : s,
      ),
    );
  };
  const move = (index: number, delta: -1 | 1) => {
    const next = [...steps];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    const nextKeys = [...stepKeys];
    const [movedKey] = nextKeys.splice(index, 1);
    nextKeys.splice(index + delta, 0, movedKey);
    stepKeysRef.current = nextKeys;
    onChange(next);
    setExpanded(prev => {
      const swapped = new Set<number>();
      prev.forEach(i => {
        if (i === index) swapped.add(index + delta);
        else if (i === index + delta) swapped.add(index);
        else swapped.add(i);
      });
      return swapped;
    });
  };
  const insertAt = (index: number) => {
    stepKeysRef.current = [
      ...stepKeys.slice(0, index),
      nextKey(),
      ...stepKeys.slice(index),
    ];
    onChange([
      ...steps.slice(0, index),
      makeEmptyStep(steps),
      ...steps.slice(index),
    ]);
    // Shift expanded indices at/after the insert point, and open the new step.
    setExpanded(prev => {
      const shifted = new Set<number>();
      prev.forEach(i => shifted.add(i >= index ? i + 1 : i));
      shifted.add(index);
      return shifted;
    });
  };
  const removeStep = (index: number) => {
    stepKeysRef.current = stepKeys.filter((_, i) => i !== index);
    onChange(steps.filter((_, i) => i !== index));
    setExpanded(prev => {
      const next = new Set<number>();
      prev.forEach(i => {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      });
      return next;
    });
  };

  return (
    <div className="flex flex-col">
      {steps.map((step, index) => {
        const integration = integrations.find(i => i.id === step.integrationId);
        const logo = resolveLogo(integration);
        const idInvalid = !isValidStepId(step.id);
        const idDuplicate = steps.some(
          (s, i) => i !== index && s.id === step.id,
        );
        const stepKey = stepKeys[Number(index)];
        return (
          <div key={stepKey}>
            <InsertStepConnector
              state={connectorState(step, running, runResult)}
              items={[
                {
                  icon: <Zap className="size-4" />,
                  label: 'Action step',
                  onSelect: () => insertAt(index),
                },
              ]}
              disabled={disabled}
              testId={`insert-step-${index}`}
              addLabel="Add step"
            />
            <StepNode
              testId={`action-step-${index}`}
              icon={
                integration ? (
                  <IntegrationLogo src={logo} size={20} />
                ) : (
                  <Zap className="size-5 text-primary" />
                )
              }
              title={step.id}
              subtitle={
                step.request.backendType === 'aws' &&
                step.request.service.trim()
                  ? `${step.request.service}:${step.request.operation || step.request.method}${
                      integration ? ` — ${integration.name}` : ''
                    }`
                  : step.request.path.trim()
                    ? `${step.request.method} ${step.request.path}${
                        integration ? ` — ${integration.name}` : ''
                      }`
                    : 'Not configured'
              }
              status={stepStatus(step, running, runResult)}
              variant="source"
              expanded={expanded.has(index)}
              onToggle={() => toggle(index)}
              onDelete={
                steps.length > 1 && !disabled
                  ? () => removeStep(index)
                  : undefined
              }
              deleteLabel={`Remove step ${index + 1}`}
              headerActions={
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-foreground"
                    aria-label={`Move step ${index + 1} up`}
                    disabled={disabled || index === 0}
                    onClick={e => {
                      e.stopPropagation();
                      move(index, -1);
                    }}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-foreground"
                    aria-label={`Move step ${index + 1} down`}
                    disabled={disabled || index === steps.length - 1}
                    onClick={e => {
                      e.stopPropagation();
                      move(index, 1);
                    }}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                </>
              }
              disabled={false}
            >
              <div className="space-y-4">
                <OutlinedInput
                  label="Step id — reference outputs as {{steps.<id>.data...}}"
                  value={step.id}
                  disabled={disabled}
                  onChange={e => patchStep(index, { id: e.target.value })}
                />
                {idInvalid && (
                  <p className="text-xs text-destructive">
                    Step id must be an identifier (letters, digits and
                    underscores, not starting with a digit) and not a reserved
                    word (true, false, null).
                  </p>
                )}
                {idDuplicate && (
                  <p className="text-xs text-destructive">
                    Step id must be unique within the action.
                  </p>
                )}

                <IntegrationSelector
                  integrations={integrations}
                  selectedIntegrationId={step.integrationId || undefined}
                  disabled={disabled}
                  createBackendType="http"
                  onSelect={selectedIntegration => {
                    patchStep(index, {
                      integrationId: selectedIntegration.id,
                      request:
                        selectedIntegration.backendType === 'aws'
                          ? makeAwsServiceActionRequest(selectedIntegration)
                          : {
                              method: 'GET',
                              path: '',
                              headers: [],
                              body: '',
                            },
                    });
                    if (
                      !integrations.some(i => i.id === selectedIntegration.id)
                    ) {
                      onIntegrationCreated(selectedIntegration.id);
                    }
                  }}
                />

                {integration?.backendType === 'aws' &&
                  step.request.backendType === 'aws' && (
                    <AwsServiceActionFields
                      integration={integration}
                      request={step.request}
                      disabled={disabled}
                      onChange={request => patchStep(index, { request })}
                    />
                  )}

                <div className="flex gap-3">
                  <div className="w-40">
                    <OutlinedSelect
                      label="Method"
                      value={step.request.method}
                      disabled={disabled}
                      onValueChange={v =>
                        patchRequest(index, {
                          method: v as ActionRequest['method'],
                        })
                      }
                    >
                      {HTTP_METHODS.map(m => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </OutlinedSelect>
                  </div>
                  <div className="flex-1">
                    <OutlinedInput
                      label="Path (e.g. /orgs/{{org}}/repos)"
                      value={step.request.path}
                      disabled={disabled}
                      onChange={e =>
                        patchRequest(index, { path: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Headers
                  </p>
                  <HeadersEditor
                    headers={step.request.headers}
                    onChange={headers => patchRequest(index, { headers })}
                    nameLabel="Key"
                    valueLabel="Value"
                    disabled={disabled}
                    emptyStateMode="button"
                    emptyAddLabel="Add header"
                    bottomAddLabel="Add header"
                    removeButtonClassName="size-8 shrink-0"
                  />
                </div>

                {METHODS_WITH_BODY.includes(step.request.method) && (
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${stepKey}-body`}
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Body template — JSON; insert params unquoted, e.g.{' '}
                      <code>{'{"name":{{name}}}'}</code>
                    </label>
                    <JsonEditor
                      id={`${stepKey}-body`}
                      ariaLabel="Request body (JSON)"
                      value={step.request.body}
                      onChange={body => patchRequest(index, { body })}
                      lintSource={templateTolerantJsonLintSource}
                      readOnly={disabled}
                      resetKey={`${editorResetKey ?? 'initial'}:${step.integrationId}`}
                      height="auto"
                      minHeight="120px"
                      maxHeight="60vh"
                      resizable
                      placeholder={'{"name":{{name}}}'}
                    />
                  </div>
                )}
              </div>
            </StepNode>
          </div>
        );
      })}

      <InsertStepConnector
        items={[
          {
            icon: <Zap className="size-4" />,
            label: 'Action step',
            onSelect: () => insertAt(steps.length),
          },
        ]}
        disabled={disabled}
        testId={`insert-step-${steps.length}`}
        addLabel="Add step"
      />
    </div>
  );
}
