/*
 * Copyright 2026 Larder Software Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Single source of truth for "does a data-ingestion source node have enough
 * config to execute". Shared by the frontend (the data-source editor + list
 * view) and the backend (context-group materialization / status), which
 * previously kept separate copies that drifted — the backend's AWS check only
 * recognised single-resource sources and wrongly flagged cloud-control
 * (resource-type) sources like ECR as unconfigured.
 */

export const AWS_ACCOUNT_ID_PATTERN = /^\d{12}$/;
export const AWS_ACCOUNT_ID_MESSAGE = 'Must be a 12-digit AWS account ID';

export function isAwsAccountId(value: string): boolean {
  return AWS_ACCOUNT_ID_PATTERN.test(value.trim());
}

export function isAwsAccountIdValue(
  value: string,
  options?: { allowTemplates?: boolean },
): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (options?.allowTemplates && /\{\{[^}]+\}\}/.test(trimmed)) {
    return true;
  }
  return isAwsAccountId(trimmed);
}

export function getInvalidAwsAccountIds(
  ids: string[],
  options?: { allowTemplates?: boolean },
): string[] {
  return ids.filter(id => !isAwsAccountIdValue(id, options));
}

/**
 * Validates the optional CloudControl resource-model JSON. Returns an error
 * string when it is present but unparseable (after collapsing `{{ template }}`
 * placeholders), or `undefined` when absent/blank/valid.
 */
export function getResourceModelJsonError(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    JSON.parse(trimmed);
    return undefined;
  } catch {
    try {
      const withTemplatePlaceholders = trimmed.replace(
        /\{\{[\s\S]*?\}\}/g,
        '"__TMPL__"',
      );
      JSON.parse(withTemplatePlaceholders);
      return undefined;
    } catch {
      return 'Invalid JSON';
    }
  }
}

export function hasDynamicAwsAccountSelection(
  config: Record<string, unknown>,
): boolean {
  const selection = config.accountSelection;
  return (
    typeof selection === 'object' &&
    selection !== null &&
    (selection as { mode?: unknown }).mode === 'all'
  );
}

/**
 * Authoritative check for whether an AWS source node has enough config to
 * execute. Three modes: `configured-accounts` (emit accounts from the
 * integration), `service-api` (a specific service operation), and the default
 * `cloud-control` (scan a resource type across accounts/regions, e.g. ECR).
 * Service API and cloud-control require at least one account target and valid
 * account-id formats. Service API request details may be omitted when the
 * operation metadata supplies them at execution time.
 */
export function isAwsSourceConfigured(
  config: Record<string, unknown>,
): boolean {
  if (config.mode === 'configured-accounts') {
    return true;
  }

  const invalidAccountIds = [
    ...getInvalidAwsAccountIds(
      (config.accountIds as string[] | undefined) ?? [],
    ),
    ...getInvalidAwsAccountIds(
      (config.accountSelection as { excludedAccountIds?: string[] } | undefined)
        ?.excludedAccountIds ?? [],
    ),
  ];
  if (invalidAccountIds.length > 0) {
    return false;
  }

  const hasAccountTargets =
    Boolean((config.accountIds as string[] | undefined)?.length) ||
    hasDynamicAwsAccountSelection(config);
  const awsMode =
    config.mode === 'service-api' ? 'service-api' : 'cloud-control';
  if (awsMode === 'service-api') {
    return Boolean(hasAccountTargets && config.service && config.operation);
  }
  return Boolean(
    hasAccountTargets &&
    config.resourceType &&
    !getResourceModelJsonError(config.resourceModel),
  );
}

/**
 * Whether a data-ingestion source node is configured enough to run.
 *
 * `sourceType` is the node type as stored on the workflow
 * (`source-datastore` / `source-integration` / `source-chained`) or the
 * editor's abstract kind (`datastore` / `http` / `aws`). AWS-ness is taken from
 * the resolved integration's `backendType` when available — the persisted
 * source config only carries `backendType` when the integration was picked
 * through the source-config UI, so sources created another way (MCP,
 * programmatic, older versions) rely on the integration to classify them.
 */
export function checkSourceConfigured(
  sourceType: string | undefined,
  config: Record<string, unknown> | undefined,
  integrationBackendType?: string,
): boolean {
  if (!sourceType || !config) return false;

  if (sourceType === 'source-datastore' || sourceType === 'datastore') {
    return (
      typeof config.datasourceId === 'string' && config.datasourceId.length > 0
    );
  }

  const backendType =
    integrationBackendType ?? (config.backendType as string | undefined);

  if (backendType === 'aws' || sourceType === 'aws') {
    return isAwsSourceConfigured(config);
  }

  if (!config.integrationId) return false;
  if (config.mode === 'graphql') {
    const query = config.graphqlQuery;
    return typeof query === 'string' && query.trim().length > 0;
  }
  return typeof config.path === 'string' && config.path.trim().length > 0;
}
