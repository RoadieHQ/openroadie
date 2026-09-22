import React, { useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../../api/queries';
import { workspaceQueryKey } from '../../../../api/workspace-scope';
import { useInvalidatingMutation } from '../../../../api/query-hooks';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { Combobox, type ComboboxOption } from '@roadiehq/ui/combobox';
import {
  MentionsTextField,
  type SuggestionDataSource,
  type BaseSuggestionData,
} from '@roadiehq/ui/mentions-text-field';
import { AdvancedSection } from '@roadiehq/ui/advanced-section';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roadiehq/ui/select';
import { useAlert, useSecrets } from '../../../../api';
import { useDataSourceEditorContext } from '../data-source-editor-context';
import type {
  HttpIntegrationSourceConfig,
  PaginationConfig,
  PaginationMode,
} from '../data-source-editor-context';
import type { IntegrationPaginationDefault } from '../../../../api/workflow/workflow-client';
import {
  INTEGRATION_PATH_SUGGESTIONS,
  extractPathParams,
  buildPath,
  PathSuggestion,
} from './integration-path-suggestions';
import { PaginationSettings } from './pagination-settings';
import { GraphqlSourceFields } from './graphql-source-fields';
import { HeadersEditor, JsonEditor } from '../../../common/request-editor';
import { parseRequestBodyText } from '../../request-body';
import type { Integration } from '../../../integrations/types';
// Recognises numeric version segments like `1`, `1.0`, `2.3.4` without the
// nested-quantifier pattern that triggers security/detect-unsafe-regex.
const isNumericVersion = (segment: string): boolean => {
  if (!segment) return false;
  const parts = segment.split('.');
  return parts.every(part => part.length > 0 && /^\d+$/.test(part));
};

type PathSuggestionOption = PathSuggestion & {
  group: string;
  effectivePaginationDefault?: IntegrationPaginationDefault;
};

// Stable empty reference so `pathSuggestions` doesn't churn while the query is
// idle or unresolved.
const EMPTY_SUGGESTIONS: PathSuggestionOption[] = [];

const formatGroupLabel = (segment: string): string =>
  segment
    .split(/[_-]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const getPathGroup = (path: string): string => {
  const segments = path
    .split('/')
    .filter(Boolean)
    .filter(segment => !segment.startsWith('{'));
  if (segments.length === 0) {
    return 'Other';
  }
  if (
    segments[0] === 'api' &&
    segments.length >= 3 &&
    /^v\d+$/i.test(segments[1])
  ) {
    return formatGroupLabel(segments[2]);
  }
  if (/^v\d+$/i.test(segments[0]) && segments.length >= 2) {
    return formatGroupLabel(segments[1]);
  }
  if (isNumericVersion(segments[0]) && segments.length >= 2) {
    return formatGroupLabel(segments[1]);
  }
  return formatGroupLabel(segments[0]);
};

const getMatchScore = (
  option: PathSuggestionOption,
  inputValue: string,
): number => {
  const query = inputValue.trim().toLowerCase();
  if (!query) {
    return 0;
  }
  const path = option.path.toLowerCase();
  const description = option.description.toLowerCase();
  const pathParts = path.split(/[^a-z0-9]+/g).filter(Boolean);
  const descriptionParts = description.split(/[^a-z0-9]+/g).filter(Boolean);
  let score = 0;
  if (path === query) {
    score += 1200;
  }
  if (path.startsWith(query)) {
    score += 900;
  }
  if (description.startsWith(query)) {
    score += 750;
  }
  const pathIndex = path.indexOf(query);
  if (pathIndex !== -1) {
    score += 500 - Math.min(pathIndex, 250);
  }
  const descriptionIndex = description.indexOf(query);
  if (descriptionIndex !== -1) {
    score += 350 - Math.min(descriptionIndex, 250);
  }
  if (pathParts.includes(query)) {
    score += 550;
  }
  if (descriptionParts.includes(query)) {
    score += 350;
  }
  if (pathParts.some(part => part.startsWith(query))) {
    score += 450;
  }
  if (descriptionParts.some(part => part.startsWith(query))) {
    score += 300;
  }
  const queryTerms = query.split(/\s+/).filter(Boolean);
  if (queryTerms.length > 1) {
    for (const term of queryTerms) {
      if (path.includes(term)) {
        score += 75;
      } else if (description.includes(term)) {
        score += 50;
      } else {
        score -= 100;
      }
    }
  }
  return score;
};

const clonePagination = (
  pagination?: IntegrationPaginationDefault | PaginationConfig,
): PaginationConfig | undefined => {
  if (!pagination) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(pagination)) as PaginationConfig;
};

const getIntegrationPaginationDefault = (
  integration?: Integration | null,
): PaginationConfig | undefined => {
  const paginationDefault = integration?.config?.paginationDefault;
  if (
    !paginationDefault ||
    typeof paginationDefault !== 'object' ||
    Array.isArray(paginationDefault) ||
    typeof (paginationDefault as { type?: unknown }).type !== 'string'
  ) {
    return undefined;
  }

  return clonePagination(paginationDefault as IntegrationPaginationDefault);
};

const getRestPaginationMode = (
  config: HttpIntegrationSourceConfig,
): PaginationMode => {
  if (config.paginationMode) {
    return config.paginationMode;
  }
  if (config.pagination && config.pagination.type !== 'none') {
    return 'custom';
  }
  return 'inherit';
};

const getDefaultCustomPagination = (
  effectivePaginationDefault?: IntegrationPaginationDefault,
): PaginationConfig => {
  if (
    effectivePaginationDefault &&
    effectivePaginationDefault.type !== 'none'
  ) {
    return clonePagination(effectivePaginationDefault)!;
  }
  return {
    type: 'page',
    pageParam: 'page',
    perPageParam: 'per_page',
    perPage: 100,
    startPage: 1,
  };
};

interface HttpSourceConfigProps {
  config: HttpIntegrationSourceConfig;
  onChange: (key: string, value: unknown) => void;
  integration?: Integration | null;
  onIntegrationUpdated?: (integration: Integration) => void;
}

export function HttpSourceConfig({
  config,
  onChange,
  integration,
  onIntegrationUpdated,
}: HttpSourceConfigProps) {
  const { workflowApi } = useDataSourceEditorContext();
  const secretsApi = useSecrets();
  const alertApi = useAlert();
  const { data: secrets = [] } = useQuery({
    queryKey: queryKeys.secretKeys,
    queryFn: () => secretsApi.getKeys(),
  });

  const secretsDataSource: SuggestionDataSource<BaseSuggestionData> = useMemo(
    () => ({
      trigger: '@',
      markup: '@[__display__](__id__)',
      displayTransform: (id: string, display?: string) =>
        `\${${display || id}}`,
      data: async (query: string) =>
        secrets
          .filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
          .map(s => ({ id: s.name, display: s.name })),
    }),
    [secrets],
  );

  const hardcodedSuggestions = useMemo(() => {
    if (!integration?.slug) {
      return [];
    }
    return (INTEGRATION_PATH_SUGGESTIONS[integration.slug] || []).map(
      suggestion => ({
        ...suggestion,
        group: getPathGroup(suggestion.path),
      }),
    ) as PathSuggestionOption[];
  }, [integration?.slug]);

  const selectedMethod: 'GET' | 'POST' =
    config.method === 'POST' ? 'POST' : 'GET';

  const bodyText =
    config.bodyText ??
    (config.body !== undefined ? JSON.stringify(config.body, null, 2) : '');
  const bodyError = useMemo(() => {
    if (selectedMethod !== 'POST') {
      return null;
    }
    const result = parseRequestBodyText(bodyText);
    return result.ok ? null : result.error;
  }, [selectedMethod, bodyText]);

  const integrationId = integration?.id;
  const suggestionsQuery = useQuery({
    queryKey: workspaceQueryKey(
      'integrationSchemas',
      'pathSuggestions',
      integrationId ?? '',
      selectedMethod,
    ),
    queryFn: async () => {
      const paths = await workflowApi.integrationSchemas.listPathSuggestions(
        integrationId ?? '',
        selectedMethod,
      );
      return paths.map(p => ({
        path: p.pathPattern,
        description: p.description ?? p.pathPattern,
        group: getPathGroup(p.pathPattern),
        effectivePaginationDefault: p.effectivePaginationDefault,
      }));
    },
    enabled: !!integrationId,
  });
  const fetchedSuggestions = suggestionsQuery.data ?? EMPTY_SUGGESTIONS;

  const pathSuggestions = useMemo(() => {
    if (fetchedSuggestions.length > 0) {
      return fetchedSuggestions;
    }
    return hardcodedSuggestions;
  }, [fetchedSuggestions, hardcodedSuggestions]);
  const integrationPaginationDefault = useMemo(
    () => getIntegrationPaginationDefault(integration),
    [integration],
  );

  const pathTemplate = config.pathTemplate || config.path || '';
  const pathParams = useMemo(
    () => config.pathParams || {},
    [config.pathParams],
  );
  const extractedParams = useMemo(
    () => extractPathParams(pathTemplate),
    [pathTemplate],
  );
  const computedPath = useMemo(
    () => buildPath(pathTemplate, pathParams),
    [pathTemplate, pathParams],
  );
  // The effective pagination default comes from the path's schema when one is
  // resolvable; otherwise it falls back to the saved config / integration
  // default (also the state while the schema query is loading or errored).
  const schemaEnabled =
    config.mode !== 'graphql' && !!integrationId && !!pathTemplate;
  const schemaQuery = useQuery({
    queryKey: workspaceQueryKey(
      'integrationSchemas',
      'schema',
      integrationId ?? '',
      pathTemplate,
      selectedMethod,
    ),
    queryFn: async () =>
      (await workflowApi.integrationSchemas.getSchema(
        integrationId ?? '',
        pathTemplate,
        selectedMethod,
      )) ?? null,
    enabled: schemaEnabled,
  });
  const configPaginationDefault =
    (config.effectivePaginationDefault as PaginationConfig | undefined) ??
    integrationPaginationDefault;
  const currentEffectivePaginationDefault =
    schemaEnabled && schemaQuery.data !== undefined
      ? (clonePagination(schemaQuery.data?.effectivePaginationDefault) ??
        integrationPaginationDefault)
      : configPaginationDefault;

  const effectivePaginationDefault = useMemo(
    () =>
      currentEffectivePaginationDefault ??
      (config.effectivePaginationDefault as PaginationConfig | undefined) ??
      integrationPaginationDefault,
    [
      currentEffectivePaginationDefault,
      config.effectivePaginationDefault,
      integrationPaginationDefault,
    ],
  );
  const mode = config.mode === 'graphql' ? 'graphql' : 'rest';
  const restPaginationMode = useMemo(
    () => getRestPaginationMode(config),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only pagination fields affect the result
    [config.pagination, config.paginationMode],
  );
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const restPaginationModeRef = useRef(restPaginationMode);
  restPaginationModeRef.current = restPaginationMode;

  const applyPathSelection = useCallback(
    (
      selectedPath: string,
      suggestedPaginationDefault?: IntegrationPaginationDefault,
    ) => {
      const resolvedPaginationDefault =
        clonePagination(suggestedPaginationDefault) ??
        integrationPaginationDefault;
      onChange('pathTemplate', selectedPath);
      const params = extractPathParams(selectedPath);
      if (params.length === 0) {
        onChange('path', selectedPath);
        onChange('pathParams', {});
      } else {
        const newParams: Record<string, string> = Object.fromEntries(
          params.map(p => [p, pathParams[`${p}`] ?? '']),
        );
        onChange('pathParams', newParams);
        onChange('path', buildPath(selectedPath, newParams));
      }
      onChange('effectivePaginationDefault', resolvedPaginationDefault);
      if (
        modeRef.current === 'rest' &&
        restPaginationModeRef.current === 'inherit'
      ) {
        onChange('paginationMode', 'inherit');
      }
    },
    [integrationPaginationDefault, onChange, pathParams],
  );

  const handlePathInputChange = useCallback(
    (value: string) => {
      const matched = pathSuggestions.find(
        suggestion => suggestion.path === value,
      );
      applyPathSelection(value, matched?.effectivePaginationDefault);
    },
    [applyPathSelection, pathSuggestions],
  );

  const handlePathParamChange = useCallback(
    (paramName: string, value: string) => {
      const newParams = { ...pathParams, [paramName]: value };
      onChange('pathParams', newParams);
      onChange('path', buildPath(pathTemplate, newParams));
    },
    [pathParams, pathTemplate, onChange],
  );

  const handlePaginationChange = useCallback(
    (pagination: PaginationConfig) => {
      onChange('pagination', pagination);
    },
    [onChange],
  );

  const handlePaginationModeChange = useCallback(
    (paginationMode: PaginationMode) => {
      onChange('paginationMode', paginationMode);
      if (paginationMode === 'inherit') {
        onChange('effectivePaginationDefault', effectivePaginationDefault);
        return;
      }
      if (paginationMode === 'custom') {
        const currentPagination = config.pagination;
        if (!currentPagination || currentPagination.type === 'none') {
          onChange(
            'pagination',
            getDefaultCustomPagination(effectivePaginationDefault),
          );
        }
      }
    },
    [config.pagination, effectivePaginationDefault, onChange],
  );

  const paginationDefaultToApply = useMemo(() => {
    if (mode !== 'rest') {
      return undefined;
    }
    if (restPaginationMode === 'disabled') {
      return { type: 'none' } as PaginationConfig;
    }
    if (restPaginationMode === 'custom' && config.pagination) {
      return clonePagination(config.pagination);
    }
    return undefined;
  }, [config.pagination, mode, restPaginationMode]);

  const applyToIntegrationMutation = useInvalidatingMutation({
    mutationFn: ({
      id,
      config,
    }: {
      id: string;
      config: Record<string, unknown>;
    }) => workflowApi.integrations.update(id, { config }),
    invalidates: (_updated, { id }) => [queryKeys.integrationDetail(id)],
  });
  const applyingToIntegration = applyToIntegrationMutation.isPending;
  const { mutateAsync: applyPaginationToIntegration } =
    applyToIntegrationMutation;

  const handleApplyToIntegration = useCallback(async () => {
    if (!integration?.id || !paginationDefaultToApply) {
      return;
    }

    // mutateAsync so we can sequence the upstream cache seed / toast off the
    // returned integration; wrapped in try/catch as the standard requires.
    try {
      const updatedIntegration = await applyPaginationToIntegration({
        id: integration.id,
        config: {
          ...(integration.config ?? {}),
          paginationDefault: paginationDefaultToApply,
        },
      });
      onIntegrationUpdated?.(updatedIntegration);
      alertApi.post({
        message: 'Integration default pagination updated',
        severity: 'success',
        display: 'transient',
      });
    } catch (error) {
      alertApi.post({
        message: `Failed to update integration pagination: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        severity: 'error',
      });
    }
  }, [
    alertApi,
    integration,
    onIntegrationUpdated,
    paginationDefaultToApply,
    applyPaginationToIntegration,
  ]);

  const sortedSuggestionOptions = useMemo((): ComboboxOption[] => {
    const query = pathTemplate.trim();
    return [...pathSuggestions]
      .sort((a, b) => {
        const scoreDiff = getMatchScore(b, query) - getMatchScore(a, query);
        if (scoreDiff !== 0) return scoreDiff;
        const groupCmp = a.group.localeCompare(b.group);
        if (groupCmp !== 0) return groupCmp;
        return a.path.localeCompare(b.path);
      })
      .map(suggestion => ({
        value: suggestion.path,
        description: suggestion.description,
      }));
  }, [pathSuggestions, pathTemplate]);

  return (
    <div className="flex flex-col gap-4">
      {mode === 'graphql' ? (
        <GraphqlSourceFields config={config} onChange={onChange} />
      ) : (
        <>
          <div>
            <div className="flex items-start">
              <Select
                value={selectedMethod}
                onValueChange={value => onChange('method', value)}
              >
                <SelectTrigger
                  aria-label="HTTP method"
                  data-testid="http-source-method"
                  className="w-[104px] shrink-0 rounded-sm rounded-r-none border-r-0 border-input-border font-mono text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                </SelectContent>
              </Select>
              <div className="min-w-0 flex-1">
                <Combobox
                  label="API Path"
                  value={pathTemplate}
                  onChange={handlePathInputChange}
                  options={sortedSuggestionOptions}
                  placeholder="/api/v1/users"
                  className="rounded-l-none"
                  data-testid="http-source-path"
                />
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Path relative to the integration host
            </p>

            {extractedParams.length > 0 && (
              <div className="mt-4">
                <h4 className="mb-2 text-sm font-medium">
                  Path Parameters
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    (required)
                  </span>
                </h4>
                <div className="flex flex-col gap-2">
                  {extractedParams.map(param => {
                    const value =
                      (pathParams[`${param}`] as string | undefined) ?? '';
                    return (
                      <OutlinedInput
                        key={param}
                        label={`${param}${value ? '' : ' *'}`}
                        value={value}
                        onChange={e =>
                          handlePathParamChange(param, e.target.value)
                        }
                        placeholder={`Enter ${param}`}
                        aria-required="true"
                        aria-invalid={!value}
                        className={
                          value
                            ? undefined
                            : 'border-destructive hover:border-destructive focus-visible:border-destructive focus-visible:ring-destructive'
                        }
                        labelClassName={value ? undefined : 'text-destructive'}
                      />
                    );
                  })}
                </div>
                <p className="mt-2 block text-xs text-muted-foreground">
                  Preview: {computedPath}
                </p>
              </div>
            )}
          </div>

          {selectedMethod === 'POST' && (
            <div>
              <label
                htmlFor="http-request-body"
                className="mb-1 block text-sm font-medium"
              >
                Request body (JSON)
              </label>
              <JsonEditor
                id="http-request-body"
                ariaLabel="Request body (JSON)"
                value={bodyText}
                onChange={value => onChange('bodyText', value)}
                error={
                  bodyError
                    ? `Request body JSON is invalid: ${bodyError}`
                    : null
                }
                placeholder='{"query": "status:active"}'
                data-testid="http-source-body"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Optional JSON payload sent with the POST request
              </p>
            </div>
          )}
        </>
      )}

      <AdvancedSection>
        <HeadersEditor
          headers={config.headers || []}
          onChange={headers => onChange('headers', headers)}
          title="Additional Headers"
          emptyStateMode="button"
          emptyAddLabel="Add request headers"
          bottomAddLabel="Add Header"
          nameLabel="Header name"
          renderValueInput={({ value, onChange: onValueChange }) => (
            <MentionsTextField
              size="small"
              placeholder="Value (type @ to insert a secret)"
              value={value}
              onChange={newValue => onValueChange(newValue)}
              dataSources={[secretsDataSource]}
              fullWidth
            />
          )}
          addButtonClassName="self-start"
          removeButtonClassName="size-8 shrink-0"
        />

        <div>
          <h4 className="mb-4 text-sm font-medium">Response Parsing</h4>
          <div className="flex flex-col gap-4">
            {mode !== 'graphql' && (
              <div>
                <OutlinedInput
                  label="Array Expression"
                  value={(config.arrayExpression as string) ?? '$'}
                  onChange={e => onChange('arrayExpression', e.target.value)}
                  placeholder="$"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  JSONata expression to extract the array of items from the
                  response
                </p>
              </div>
            )}
            <div>
              <OutlinedInput
                label="Object ID Expression"
                value={(config.objectIdExpression as string) ?? 'id'}
                onChange={e => onChange('objectIdExpression', e.target.value)}
                placeholder="id"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                JSONata expression to extract a unique identifier from each item
              </p>
            </div>
          </div>
        </div>

        <PaginationSettings
          pagination={config.pagination}
          onChange={handlePaginationChange}
          mode={mode}
          graphqlQuery={config.graphqlQuery}
          paginationMode={mode === 'rest' ? restPaginationMode : undefined}
          onPaginationModeChange={
            mode === 'rest' ? handlePaginationModeChange : undefined
          }
          effectivePaginationDefault={
            mode === 'rest' ? effectivePaginationDefault : undefined
          }
          onApplyToIntegration={
            mode === 'rest' && integration?.id && paginationDefaultToApply
              ? handleApplyToIntegration
              : undefined
          }
          applyingToIntegration={applyingToIntegration}
        />
      </AdvancedSection>
    </div>
  );
}
