import {
  getAwsOperationMetadata,
  getAwsServiceMetadata,
} from '@roadiehq/types';
import type { WorkflowDefinition } from '../../api/workflow/workflow-client';
import type { SourceConfig } from './data-source-editor/data-source-editor-context';
import type { PipelineStep } from './types';

const AUTO_DRAFT_NAME_PREFIX = 'Data Source ';

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function isDynamicPathSegment(segment: string) {
  return /^\{.+\}$/.test(segment) || /^:.+/.test(segment);
}

function humanizeIdentifier(value: string) {
  return normalizeWhitespace(
    value
      .replace(/[_-]+/g, ' ')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2'),
  ).replace(/\b\w/g, char => char.toUpperCase());
}

function stripAwsPrefix(value: string) {
  return value.replace(/^AWS\s+/i, '');
}

const AWS_OPERATION_VERB_PREFIX =
  /^(?:List|Describe|Get|Create|Update|Delete|Put|Batch(?:Get|Write)|Search|Associate|Disassociate|Attach|Detach|Enable|Disable|Start|Stop|Terminate|Cancel|Register|Deregister|Import|Export|Upload|Download|Tag|Untag|Add|Remove|Set|Modify|Allocate|Release|Accept|Reject)\s+/i;

function stripAwsOperationVerb(label: string) {
  const normalized = normalizeWhitespace(label);
  const stripped = normalized.replace(AWS_OPERATION_VERB_PREFIX, '').trim();
  return stripped || normalized;
}

function getAwsSourceMode(config: Record<string, unknown>) {
  return config.mode === 'service-api' ? 'service-api' : 'cloud-control';
}

export function isAutoNamedDataSourceDraft(
  workflow: WorkflowDefinition | undefined,
) {
  return Boolean(
    workflow?.name.startsWith(AUTO_DRAFT_NAME_PREFIX) &&
    (workflow.nodes?.length ?? 0) === 0,
  );
}

export function getDataSourcePathLabel(path: string | undefined) {
  const normalizedPath = normalizeWhitespace(path ?? '').split(/[?#]/, 1)[0];
  if (!normalizedPath) {
    return undefined;
  }

  const segments = normalizedPath.split('/').filter(Boolean).reverse();
  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (!segment || isDynamicPathSegment(segment)) {
      continue;
    }
    return humanizeIdentifier(segment);
  }

  return undefined;
}

export function buildSuggestedDataSourceName(options: {
  draftName: string;
  integrationName?: string;
  targetLabel?: string;
}) {
  const draftName = normalizeWhitespace(options.draftName);
  const integrationName = normalizeWhitespace(options.integrationName ?? '');
  const targetLabel = normalizeWhitespace(options.targetLabel ?? '');

  if (integrationName && targetLabel) {
    return `${integrationName} ${targetLabel}`;
  }

  if (integrationName) {
    return `${integrationName} ${draftName}`;
  }

  return draftName;
}

function getIntegrationLabel(config: Record<string, unknown>) {
  const integrationName = normalizeWhitespace(
    String(config.integrationName ?? ''),
  );
  if (integrationName) {
    return integrationName;
  }

  const integrationHost = normalizeWhitespace(
    String(config.integrationHost ?? ''),
  );
  return integrationHost || undefined;
}

function getPathForNaming(config: Record<string, unknown>) {
  const pathTemplate = normalizeWhitespace(String(config.pathTemplate ?? ''));
  if (pathTemplate) {
    return pathTemplate;
  }

  const path = normalizeWhitespace(String(config.path ?? ''));
  return path || undefined;
}

function getAwsResourceTypeLabel(config: Record<string, unknown>) {
  const resourceType = normalizeWhitespace(String(config.resourceType ?? ''));
  if (!resourceType) {
    return undefined;
  }

  const parts = resourceType
    .split('::')
    .map(part => part.trim())
    .filter(Boolean);
  const relevantParts =
    parts[0]?.toUpperCase() === 'AWS' ? parts.slice(1) : parts;
  const label = relevantParts.map(humanizeIdentifier).join(' ');
  return label || undefined;
}

function getAwsServiceOperationLabel(config: Record<string, unknown>) {
  if (getAwsSourceMode(config) !== 'service-api') {
    return undefined;
  }

  const service = normalizeWhitespace(String(config.service ?? ''));
  const operation = normalizeWhitespace(String(config.operation ?? ''));
  if (!service && !operation) {
    return undefined;
  }

  const serviceMetadata = getAwsServiceMetadata(service);
  const operationMetadata = getAwsOperationMetadata(service, operation);
  const serviceLabel = humanizeIdentifier(
    stripAwsPrefix(serviceMetadata?.label ?? service),
  );
  const operationLabel = stripAwsOperationVerb(
    humanizeIdentifier(operationMetadata?.label ?? operation),
  );

  if (serviceLabel && operationLabel) {
    return `${serviceLabel} ${operationLabel}`;
  }

  return serviceLabel || operationLabel || undefined;
}

function getTargetLabelForNaming(config: Record<string, unknown>) {
  if (getAwsSourceMode(config) === 'service-api') {
    const awsServiceOperationLabel = getAwsServiceOperationLabel(config);
    if (awsServiceOperationLabel) {
      return awsServiceOperationLabel;
    }
  } else {
    const awsResourceTypeLabel = getAwsResourceTypeLabel(config);
    if (awsResourceTypeLabel) {
      return awsResourceTypeLabel;
    }
  }

  return getDataSourcePathLabel(getPathForNaming(config));
}

function appendEnrichedLabel(name: string) {
  return /\benriched\b/i.test(name) ? name : `${name} Enriched`;
}

export function buildSuggestedDataSourceNameFromPipeline(options: {
  draftName: string;
  sourceConfig: SourceConfig;
  transforms: PipelineStep[];
}) {
  let currentName = buildSuggestedDataSourceName({
    draftName: options.draftName,
    integrationName: getIntegrationLabel(options.sourceConfig),
    targetLabel: getTargetLabelForNaming(options.sourceConfig),
  });
  let shouldAppendEnriched = false;

  for (const transform of options.transforms) {
    if (transform.type !== 'chained-source') {
      continue;
    }

    const resultMode =
      transform.config.resultMode === 'flatten' ? 'flatten' : 'enrich';

    if (resultMode === 'flatten') {
      currentName = buildSuggestedDataSourceName({
        draftName: currentName,
        integrationName: getIntegrationLabel(transform.config),
        targetLabel: getTargetLabelForNaming(transform.config),
      });
      shouldAppendEnriched = false;
      continue;
    }

    shouldAppendEnriched = true;
  }

  return shouldAppendEnriched ? appendEnrichedLabel(currentName) : currentName;
}
