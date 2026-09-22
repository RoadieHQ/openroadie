import { AdvancedSection } from '@roadiehq/ui/advanced-section';
import { Badge } from '@roadiehq/ui/badge';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { Braces, Filter, Send, Tag } from 'lucide-react';
import { IntegrationSelector } from '../../common/integration-selector';
import { JsonataExpressionField } from '../data-source-editor/jsonata-expression-field';
import type { IntegrationBackedConfig } from '../../../api/datastore/datastore-client';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';
import { ReciprocalField } from './reciprocal-field';
import {
  LookupRequestErrorNotice,
  RelationshipFilterField,
  RelationshipTypeField,
} from './rule-fields';
import { ConfigTabs, type ConfigTab } from './config-tabs';
import { FieldHint } from '@roadiehq/ui/field-hint';
import { ResponseField } from './response-field';
import { isAdvancedIntegrationRequestPath } from './step-list-utils';

export const DEFAULT_INTEGRATION_CONFIG: IntegrationBackedConfig = {
  integrationId: '',
  method: 'GET',
  path: '',
  responseMatchExpression: '',
};

const isHttpIntegration = (integration: { backendType: 'http' | 'aws' }) =>
  integration.backendType === 'http';

export function IntegrationBackedRuleFields({
  editor,
  showRelationshipFields = true,
  layout = 'sections',
  responseSample,
  responseSampleReady = false,
  resolvedPathPreview,
  requestError,
}: {
  editor: RelationshipRuleEditorState;
  /**
   * Whether to render the relationship-type + reverse-relationship + Filters
   * blocks. The legacy flat form keeps them here (default `true`); the stepped
   * editor sets `false` because those live in its Source/Match stages.
   */
  showRelationshipFields?: boolean;
  /**
   * How to present the field groups. `sections` (default) stacks collapsible
   * `AdvancedSection`s — the legacy flat form. `tabs` lays them out as a compact
   * tab strip and drops the "Integration-backed" badge; used by the stepped
   * editor's Lookup card.
   */
  layout?: 'sections' | 'tabs';
  /**
   * The last sampled integration response, used to populate the Response
   * field's Field-mode picker. Only the stepped editor supplies it (it runs the
   * live lookup preview); the legacy form leaves Field mode empty/disabled.
   */
  responseSample?: unknown;
  /** Whether a fresh sampled response is available to pick fields from. */
  responseSampleReady?: boolean;
  /**
   * The request path with the sample source value substituted (e.g.
   * `/repos/RoadieHQ/roadie/commits`), shown beneath the path input so the
   * author sees the concrete URL the template/expression resolves to. Only the
   * stepped editor supplies it.
   */
  resolvedPathPreview?: string;
  /**
   * The last lookup request failure (HTTP status + the integration's error
   * message), shown at the bottom of the Request tab so the author sees why a
   * run failed while they're editing it. Only the stepped editor supplies it.
   */
  requestError?: { status?: number; message: string };
}) {
  const config = editor.integrationConfig ?? DEFAULT_INTEGRATION_CONFIG;
  const requestMethod = config.method?.trim().toUpperCase() || 'GET';
  const hasAdvancedRequestPath = isAdvancedIntegrationRequestPath(config);

  const updateConfig = (next: Partial<IntegrationBackedConfig>) => {
    editor.setIntegrationConfig({ ...config, ...next });
  };

  // Auto-expand only the sections that already hold a value; a new rule (empty
  // config) opens with just Request. Read at mount — this component only mounts
  // once the editor has loaded the rule into config/filter state.
  const responseConfigured = Boolean(config.responseMatchExpression?.trim());
  const metadataConfigured = Boolean(config.metadataExpression?.trim());
  const filtersConfigured = Boolean(
    editor.sourceFilterExpression?.trim() ||
    editor.targetFilterExpression?.trim(),
  );

  // Dense config-card presentation shrinks the expression textareas.
  const compact = layout === 'tabs';

  // Each field group is defined once and rendered either as a stacked
  // `AdvancedSection` (legacy `sections` layout) or a vertical icon tab
  // (`tabs` layout). `icon`/`defaultOpen` are consumed by the respective layout.
  const groups: (ConfigTab & { defaultOpen: boolean })[] = [
    {
      value: 'request',
      label: 'Request',
      icon: <Send />,
      defaultOpen: true,
      content: (
        <>
          <IntegrationSelector
            label="Integration"
            integrationFilter={isHttpIntegration}
            createBackendType="http"
            selectedIntegrationId={config.integrationId || undefined}
            onSelect={integration =>
              updateConfig({ integrationId: integration.id })
            }
          />

          {/* Request method left of the path, sharing one row. */}
          <div className="flex items-center gap-1.5">
            <Badge
              variant="outlineMuted"
              className="shrink-0 font-mono text-2xs"
            >
              {requestMethod}
            </Badge>
            <div className="min-w-0 flex-1">
              <OutlinedInput
                label="Request path"
                value={config.path}
                onChange={event => updateConfig({ path: event.target.value })}
                placeholder="e.g. /repos/{value}/teams"
                disabled={hasAdvancedRequestPath}
              />
            </div>
            {!hasAdvancedRequestPath && (
              <FieldHint ariaLabel="Request path help">
                Use {'{value}'} to insert the source field value.
              </FieldHint>
            )}
          </div>

          {hasAdvancedRequestPath && (
            <p className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-2xs text-warning">
              This rule uses an advanced request path resolved by the backend.
              Edit it through the API or CLI.
            </p>
          )}

          {/* The concrete URL the path resolves to for the sample source value,
              so the author sees what's actually requested — not the template. */}
          {!hasAdvancedRequestPath && resolvedPathPreview && (
            <div className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
              <span className="shrink-0">Resolves to</span>
              <code
                className="min-w-0 truncate font-mono text-foreground"
                title={resolvedPathPreview}
              >
                {resolvedPathPreview}
              </code>
            </div>
          )}

          {showRelationshipFields && (
            <>
              <RelationshipTypeField editor={editor} />
              <ReciprocalField editor={editor} />
            </>
          )}

          {/* The last run's failure, so it's visible right where you fix it. */}
          {requestError && (
            <div className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-2xs text-destructive">
              <LookupRequestErrorNotice error={requestError} />
            </div>
          )}
        </>
      ),
    },
    {
      value: 'response',
      label: 'Response',
      icon: <Braces />,
      defaultOpen: responseConfigured,
      content: (
        <ResponseField
          value={config.responseMatchExpression}
          onChange={responseMatchExpression =>
            updateConfig({ responseMatchExpression })
          }
          sample={responseSample}
          hasSample={responseSampleReady}
        />
      ),
    },
    {
      value: 'metadata',
      label: 'Metadata',
      icon: <Tag />,
      defaultOpen: metadataConfigured,
      content: (
        <JsonataExpressionField
          label="Metadata expression"
          compact={compact}
          value={config.metadataExpression ?? ''}
          onChange={metadataExpression =>
            updateConfig({
              metadataExpression: metadataExpression || undefined,
            })
          }
          helperText="Optional evidence to store on each relationship created by this rule."
          placeholder='{"teamId": id, "url": html_url}'
        />
      ),
    },
    ...(showRelationshipFields
      ? [
          {
            value: 'filters',
            label: 'Filters',
            icon: <Filter />,
            defaultOpen: filtersConfigured,
            content: (
              <>
                <RelationshipFilterField editor={editor} side="source" />
                <RelationshipFilterField editor={editor} side="target" />
              </>
            ),
          },
        ]
      : []),
  ];

  if (layout === 'tabs') {
    return <ConfigTabs ariaLabel="Lookup configuration" tabs={groups} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="successOutline" className="text-2xs">
          Integration-backed
        </Badge>
        <span className="text-xs text-muted-foreground">
          This preview makes bounded live calls and does not write catalog
          relationships.
        </span>
      </div>

      <div className="divide-y divide-border">
        {groups.map(group => (
          <AdvancedSection
            key={group.value}
            variant="embedded"
            defaultOpen={group.defaultOpen}
            label={group.label}
          >
            {group.content}
          </AdvancedSection>
        ))}
      </div>
    </div>
  );
}
