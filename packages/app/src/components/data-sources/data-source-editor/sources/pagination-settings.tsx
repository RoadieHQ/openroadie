import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { OutlinedNumberInput } from '@roadiehq/ui/outlined-number-input';
import { OutlinedSelect } from '@roadiehq/ui/outlined-select';
import { SelectItem } from '@roadiehq/ui/select';
import { Alert, AlertDescription } from '@roadiehq/ui/alert';
import { Button } from '@roadiehq/ui/button';
import type {
  PaginationConfig,
  PaginationMode,
} from '../data-source-editor-context';
import {
  getDeclaredVariableNames,
  suggestGraphqlCursorPagination,
} from './suggest-graphql-pagination';

interface PaginationSettingsProps {
  pagination?: PaginationConfig;
  onChange: (pagination: PaginationConfig) => void;
  mode?: 'rest' | 'graphql';
  graphqlQuery?: string;
  paginationMode?: PaginationMode;
  onPaginationModeChange?: (paginationMode: PaginationMode) => void;
  effectivePaginationDefault?: PaginationConfig;
  onApplyToIntegration?: () => void;
  applyingToIntegration?: boolean;
  title?: string | null;
}

function describePagination(pagination?: PaginationConfig): string {
  if (!pagination) {
    return 'No integration default is configured.';
  }
  switch (pagination.type) {
    case 'none':
      return 'Inherited default disables pagination.';
    case 'cursor':
      return `Cursor pagination via "${pagination.cursorParam}" using "${pagination.nextCursorExpression}" in ${pagination.paramLocation === 'body' ? (pagination.bodyParamsPath ? `the request body under "${pagination.bodyParamsPath}"` : 'the request body') : 'query parameters'}.`;
    case 'page':
      return `Page pagination via "${pagination.pageParam}" and "${pagination.perPageParam}" (${pagination.perPage} items per page).`;
    case 'offset':
      return `Offset pagination via "${pagination.offsetParam}" and "${pagination.limitParam}" (${pagination.limit} items per page) in ${pagination.paramLocation === 'body' ? (pagination.bodyParamsPath ? `the request body under "${pagination.bodyParamsPath}"` : 'the request body') : 'query parameters'}.`;
    case 'link':
      if (pagination.nextLinkCondition?.equals !== undefined) {
        return `Link header pagination with "${pagination.perPageParam ?? 'per_page'}" (${pagination.perPage ?? 100} items per page), following next only when "${pagination.nextLinkCondition.param}" equals "${pagination.nextLinkCondition.equals}"${pagination.nextRequestMethod ? `, using ${pagination.nextRequestMethod} for follow-up requests` : ''}.`;
      }
      if (pagination.nextLinkCondition?.notEquals !== undefined) {
        return `Link header pagination with "${pagination.perPageParam ?? 'per_page'}" (${pagination.perPage ?? 100} items per page), following next only when "${pagination.nextLinkCondition.param}" does not equal "${pagination.nextLinkCondition.notEquals}"${pagination.nextRequestMethod ? `, using ${pagination.nextRequestMethod} for follow-up requests` : ''}.`;
      }
      return `Link header pagination with "${pagination.perPageParam ?? 'per_page'}" (${pagination.perPage ?? 100} items per page)${pagination.nextRequestMethod ? `, using ${pagination.nextRequestMethod} for follow-up requests` : ''}.`;
    case 'body-link':
      return `Body link pagination using "${pagination.nextLinkExpression}"${pagination.nextRequestMethod ? `, with ${pagination.nextRequestMethod} for follow-up requests` : ''}.`;
    case 'graphql-cursor':
      return `GraphQL cursor pagination via "${pagination.cursorVariable}" using "${pagination.nextCursorExpression}".`;
    default:
      return 'Inherited pagination is configured.';
  }
}

function getLinkPaginationConfig(
  pagination?: PaginationConfig,
): Extract<PaginationConfig, { type: 'link' }> {
  return {
    type: 'link',
    perPageParam:
      pagination?.type === 'link' ? pagination.perPageParam : 'per_page',
    perPage: pagination?.type === 'link' ? pagination.perPage : 100,
    nextRequestMethod:
      pagination?.type === 'link' ? pagination.nextRequestMethod : undefined,
    nextLinkCondition:
      pagination?.type === 'link' ? pagination.nextLinkCondition : undefined,
  };
}

function getPaginationConfigForType(
  type: PaginationConfig['type'],
  pagination?: PaginationConfig,
): PaginationConfig {
  if (pagination?.type === type) {
    return pagination;
  }

  switch (type) {
    case 'none':
      return { type: 'none' };
    case 'cursor':
      return {
        type: 'cursor',
        cursorParam: 'cursor',
        nextCursorExpression: '',
        paramLocation: 'query',
      };
    case 'page':
      return {
        type: 'page',
        pageParam: 'page',
        perPageParam: 'per_page',
        perPage: 100,
        startPage: 1,
      };
    case 'offset':
      return {
        type: 'offset',
        offsetParam: 'offset',
        limitParam: 'limit',
        limit: 100,
        paramLocation: 'query',
      };
    case 'link':
      return getLinkPaginationConfig();
    case 'body-link':
      return {
        type: 'body-link',
        nextLinkExpression: '',
        perPageParam: 'per_page',
        perPage: 100,
      };
    case 'graphql-cursor':
      return {
        type: 'graphql-cursor',
        cursorVariable: 'after',
        nextCursorExpression: '',
      };
  }
}

export function PaginationSettings({
  pagination,
  onChange,
  mode = 'rest',
  graphqlQuery,
  paginationMode,
  onPaginationModeChange,
  effectivePaginationDefault,
  onApplyToIntegration,
  applyingToIntegration = false,
  title = 'Pagination Settings',
}: PaginationSettingsProps) {
  const resolvedPaginationMode =
    mode === 'rest'
      ? (paginationMode ??
        (pagination && pagination.type !== 'none' ? 'custom' : 'inherit'))
      : undefined;
  const paginationType = pagination?.type ?? 'none';
  const showPaginationConfig =
    mode === 'graphql' ||
    (mode === 'rest' &&
      (!onPaginationModeChange || resolvedPaginationMode === 'custom'));

  const [linkConditionParamDraft, setLinkConditionParamDraft] = useState('');
  const linkConditionParamDraftRef = useRef('');

  useEffect(() => {
    if (pagination?.type !== 'link') {
      setLinkConditionParamDraft('');
      linkConditionParamDraftRef.current = '';
      return;
    }
    const p =
      pagination?.type === 'link'
        ? pagination.nextLinkCondition?.param
        : undefined;
    if (p !== undefined) {
      setLinkConditionParamDraft(p);
      linkConditionParamDraftRef.current = p;
    }
  }, [pagination]);

  const cursorSuggestion = useMemo(() => {
    if (paginationType !== 'graphql-cursor' || !graphqlQuery) return null;
    return suggestGraphqlCursorPagination(graphqlQuery);
  }, [paginationType, graphqlQuery]);

  const cursorVariableError = useMemo(() => {
    if (paginationType !== 'graphql-cursor' || !graphqlQuery) return null;
    const cursorVar =
      pagination?.type === 'graphql-cursor'
        ? (pagination.cursorVariable ?? '')
        : '';
    const normalized = cursorVar.replace(/^\$/, '');
    if (!normalized) return null;
    const declared = getDeclaredVariableNames(graphqlQuery);
    if (declared === null) return null;
    if (declared.has(normalized)) return null;
    return `$${normalized} is not declared in the query. Add it to the operation signature, e.g. query OrgRepos($${normalized}: String).`;
  }, [paginationType, pagination, graphqlQuery]);

  const showCursorSuggestion = useMemo(() => {
    if (!cursorSuggestion) return false;
    if (pagination?.type !== 'graphql-cursor') return true;
    return (
      pagination.cursorVariable !== cursorSuggestion.cursorVariable ||
      pagination.nextCursorExpression !==
        cursorSuggestion.nextCursorExpression ||
      pagination.hasNextPageExpression !==
        cursorSuggestion.hasNextPageExpression
    );
  }, [cursorSuggestion, pagination]);

  const handleFieldChange = useCallback(
    (field: string, value: unknown) => {
      if (field === 'type') {
        onChange(
          getPaginationConfigForType(
            value as PaginationConfig['type'],
            pagination,
          ),
        );
        return;
      }
      const current = pagination ?? ({ type: 'none' } as const);
      onChange({ ...current, [field]: value } as PaginationConfig);
    },
    [pagination, onChange],
  );

  const handleNextRequestMethodChange = useCallback(
    (value: 'inherit' | 'GET' | 'POST') => {
      handleFieldChange(
        'nextRequestMethod',
        value === 'inherit' ? undefined : value,
      );
    },
    [handleFieldChange],
  );

  const handleLinkConditionParamChange = useCallback(
    (value: string) => {
      const current = getLinkPaginationConfig(pagination);
      const existing = current.nextLinkCondition;
      const hasComparator =
        existing?.equals !== undefined || existing?.notEquals !== undefined;

      setLinkConditionParamDraft(value);
      linkConditionParamDraftRef.current = value;

      if (!hasComparator) {
        if (current.nextLinkCondition !== undefined) {
          onChange({ ...current, nextLinkCondition: undefined });
        }
        return;
      }

      onChange({
        ...current,
        nextLinkCondition: value
          ? {
              param: value,
              equals: existing?.equals,
              notEquals: existing?.notEquals,
            }
          : undefined,
      });
    },
    [pagination, onChange],
  );

  const handleLinkConditionOperatorChange = useCallback(
    (value: 'none' | 'equals' | 'notEquals') => {
      const current = getLinkPaginationConfig(pagination);
      const resolvedParam =
        current.nextLinkCondition?.param ?? linkConditionParamDraftRef.current;
      const previousValue =
        current.nextLinkCondition?.equals ??
        current.nextLinkCondition?.notEquals;

      if (value === 'none') {
        const preserved =
          current.nextLinkCondition?.param ??
          linkConditionParamDraftRef.current;
        setLinkConditionParamDraft(preserved);
        linkConditionParamDraftRef.current = preserved;
        if (current.nextLinkCondition !== undefined) {
          onChange({ ...current, nextLinkCondition: undefined });
        }
        return;
      }

      const nextComparator = previousValue ?? '';
      onChange({
        ...current,
        nextLinkCondition:
          value === 'equals'
            ? { param: resolvedParam, equals: nextComparator }
            : { param: resolvedParam, notEquals: nextComparator },
      });
    },
    [pagination, onChange],
  );

  const handleLinkConditionValueChange = useCallback(
    (value: string) => {
      const current = getLinkPaginationConfig(pagination);
      const param =
        current.nextLinkCondition?.param ?? linkConditionParamDraftRef.current;
      if (!param) {
        if (current.nextLinkCondition !== undefined) {
          onChange({ ...current, nextLinkCondition: undefined });
        }
        return;
      }

      const operator =
        current.nextLinkCondition?.notEquals !== undefined
          ? 'notEquals'
          : 'equals';

      onChange({
        ...current,
        nextLinkCondition:
          operator === 'notEquals'
            ? { param, notEquals: value }
            : { param, equals: value },
      });
    },
    [pagination, onChange],
  );

  return (
    <div>
      {title ? <h4 className="mb-4 text-sm font-medium">{title}</h4> : null}
      <div className="flex flex-col gap-4">
        {mode === 'rest' && onPaginationModeChange ? (
          <>
            <OutlinedSelect
              label="Pagination Behavior"
              value={resolvedPaginationMode ?? 'inherit'}
              onValueChange={value =>
                onPaginationModeChange(value as PaginationMode)
              }
            >
              <SelectItem value="inherit">
                Inherit Integration Default
              </SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </OutlinedSelect>

            {resolvedPaginationMode === 'inherit' && (
              <Alert variant="info">
                <AlertDescription>
                  {describePagination(effectivePaginationDefault)}
                </AlertDescription>
              </Alert>
            )}

            {resolvedPaginationMode === 'disabled' && (
              <Alert variant="info">
                <AlertDescription>
                  Pagination is disabled. Only the first page will be fetched.
                </AlertDescription>
              </Alert>
            )}

            {onApplyToIntegration && resolvedPaginationMode !== 'inherit' && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onApplyToIntegration}
                  disabled={
                    applyingToIntegration || Boolean(cursorVariableError)
                  }
                >
                  Save as Integration Default
                </Button>
              </div>
            )}
          </>
        ) : null}

        {showPaginationConfig && (
          <OutlinedSelect
            label="Pagination Type"
            value={paginationType}
            onValueChange={val => handleFieldChange('type', val)}
          >
            {mode === 'rest' ? (
              <>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="cursor">Cursor</SelectItem>
                <SelectItem value="page">Page Number</SelectItem>
                <SelectItem value="offset">Offset/Limit</SelectItem>
                <SelectItem value="link">Link Header</SelectItem>
                <SelectItem value="body-link">Body Link</SelectItem>
              </>
            ) : (
              <>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="graphql-cursor">GraphQL Cursor</SelectItem>
              </>
            )}
          </OutlinedSelect>
        )}

        {showPaginationConfig && paginationType === 'cursor' && (
          <>
            <OutlinedInput
              label="Cursor Parameter"
              value={
                pagination?.type === 'cursor'
                  ? pagination.cursorParam
                  : 'cursor'
              }
              onChange={e => handleFieldChange('cursorParam', e.target.value)}
            />
            <OutlinedSelect
              label="Parameter Location"
              value={
                pagination?.type === 'cursor'
                  ? (pagination.paramLocation ?? 'query')
                  : 'query'
              }
              onValueChange={value => {
                const location = value as 'query' | 'body';
                if (location === 'query' && pagination?.type === 'cursor') {
                  onChange({
                    ...pagination,
                    paramLocation: 'query',
                    bodyParamsPath: undefined,
                  });
                  return;
                }
                handleFieldChange('paramLocation', location);
              }}
            >
              <SelectItem value="query">Query Parameters</SelectItem>
              <SelectItem value="body">Request Body</SelectItem>
            </OutlinedSelect>
            {pagination?.type === 'cursor' &&
              pagination.paramLocation === 'body' && (
                <div>
                  <OutlinedInput
                    label="Body Params Path"
                    value={pagination.bodyParamsPath ?? ''}
                    onChange={e =>
                      handleFieldChange(
                        'bodyParamsPath',
                        e.target.value || undefined,
                      )
                    }
                    placeholder="options"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Optional. Nests the cursor parameter inside a body object
                    instead of sending it at the top level. For example,
                    entering &quot;options&quot; sends it as{' '}
                    {`{"options": {"${pagination.cursorParam || 'cursor'}": "..."}}`}
                    . Use dot notation (e.g. &quot;request.paging&quot;) to nest
                    multiple levels deep, or leave blank to send it at the top
                    level.
                  </p>
                </div>
              )}
            <div>
              <OutlinedInput
                label="Next Cursor Expression"
                value={
                  pagination?.type === 'cursor'
                    ? pagination.nextCursorExpression
                    : ''
                }
                onChange={e =>
                  handleFieldChange('nextCursorExpression', e.target.value)
                }
                placeholder="response_metadata.next_cursor"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                JSONata expression to extract next cursor from response
              </p>
            </div>
          </>
        )}

        {showPaginationConfig && paginationType === 'page' && (
          <>
            <OutlinedInput
              label="Page Parameter"
              value={
                pagination?.type === 'page' ? pagination.pageParam : 'page'
              }
              onChange={e => handleFieldChange('pageParam', e.target.value)}
            />
            <OutlinedInput
              label="Per Page Parameter"
              value={
                pagination?.type === 'page'
                  ? pagination.perPageParam
                  : 'per_page'
              }
              onChange={e => handleFieldChange('perPageParam', e.target.value)}
            />
            <div>
              <OutlinedNumberInput
                label="Items Per Page"
                value={String(
                  pagination?.type === 'page' ? pagination.perPage : 100,
                )}
                onChange={val => {
                  const parsed = parseInt(val, 10);
                  handleFieldChange('perPage', parsed > 0 ? parsed : 1);
                }}
                min={1}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Must be greater than 0
              </p>
            </div>
            <div>
              <OutlinedNumberInput
                label="Start Page"
                value={String(
                  pagination?.type === 'page' ? (pagination.startPage ?? 1) : 1,
                )}
                onChange={val => {
                  const parsed = parseInt(val, 10);
                  handleFieldChange('startPage', parsed > 0 ? parsed : 1);
                }}
                min={1}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Must be greater than 0
              </p>
            </div>
          </>
        )}

        {showPaginationConfig && paginationType === 'offset' && (
          <>
            <OutlinedInput
              label="Offset Parameter"
              value={
                pagination?.type === 'offset'
                  ? pagination.offsetParam
                  : 'offset'
              }
              onChange={e => handleFieldChange('offsetParam', e.target.value)}
            />
            <OutlinedInput
              label="Limit Parameter"
              value={
                pagination?.type === 'offset' ? pagination.limitParam : 'limit'
              }
              onChange={e => handleFieldChange('limitParam', e.target.value)}
            />
            <OutlinedSelect
              label="Parameter Location"
              value={
                pagination?.type === 'offset'
                  ? (pagination.paramLocation ?? 'query')
                  : 'query'
              }
              onValueChange={value => {
                const location = value as 'query' | 'body';
                if (location === 'query' && pagination?.type === 'offset') {
                  onChange({
                    ...pagination,
                    paramLocation: 'query',
                    bodyParamsPath: undefined,
                  });
                  return;
                }
                handleFieldChange('paramLocation', location);
              }}
            >
              <SelectItem value="query">Query Parameters</SelectItem>
              <SelectItem value="body">Request Body</SelectItem>
            </OutlinedSelect>
            {pagination?.type === 'offset' &&
              pagination.paramLocation === 'body' && (
                <div>
                  <OutlinedInput
                    label="Body Params Path"
                    value={pagination.bodyParamsPath ?? ''}
                    onChange={e =>
                      handleFieldChange(
                        'bodyParamsPath',
                        e.target.value || undefined,
                      )
                    }
                    placeholder="options"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Optional. Dot-separated path to a nested body object to
                    merge the parameters into (e.g. &quot;options&quot; sends
                    them as {'{"options": {"$skip": 0, "$top": 100}}'}). Leave
                    empty to merge at the top level.
                  </p>
                </div>
              )}
            <div>
              <OutlinedNumberInput
                label="Limit"
                value={String(
                  pagination?.type === 'offset' ? pagination.limit : 100,
                )}
                onChange={val => {
                  const parsed = parseInt(val, 10);
                  handleFieldChange('limit', parsed > 0 ? parsed : 1);
                }}
                min={1}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Must be greater than 0
              </p>
            </div>
            <div>
              <OutlinedInput
                label="Total Expression"
                value={
                  pagination?.type === 'offset'
                    ? (pagination.totalExpression ?? '')
                    : ''
                }
                onChange={e =>
                  handleFieldChange(
                    'totalExpression',
                    e.target.value || undefined,
                  )
                }
                placeholder="count"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Optional JSONata expression for the total result count
              </p>
            </div>
          </>
        )}

        {showPaginationConfig && paginationType === 'link' && (
          <>
            <Alert variant="info">
              <AlertDescription>
                Link header pagination follows RFC 8288 standard. The API must
                return a <code>Link</code> header with{' '}
                <code>rel=&quot;next&quot;</code> for pagination to work (e.g.,
                GitHub API).
              </AlertDescription>
            </Alert>
            <div>
              <OutlinedInput
                label="Page Size Query Parameter"
                value={
                  pagination?.type === 'link'
                    ? (pagination.perPageParam ?? 'per_page')
                    : 'per_page'
                }
                onChange={e =>
                  handleFieldChange('perPageParam', e.target.value)
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Query parameter name for items per page (optional)
              </p>
            </div>
            <div>
              <OutlinedNumberInput
                label="Items Per Page"
                value={String(
                  pagination?.type === 'link'
                    ? (pagination.perPage ?? 100)
                    : 100,
                )}
                onChange={val => {
                  const parsed = parseInt(val, 10);
                  handleFieldChange('perPage', parsed > 0 ? parsed : 1);
                }}
                min={1}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Must be greater than 0
              </p>
            </div>
            <OutlinedSelect
              label="Follow-up Request Method"
              value={
                pagination?.type === 'link'
                  ? (pagination.nextRequestMethod ?? 'inherit')
                  : 'inherit'
              }
              onValueChange={value =>
                handleNextRequestMethodChange(
                  value as 'inherit' | 'GET' | 'POST',
                )
              }
            >
              <SelectItem value="inherit">Inherit Initial Method</SelectItem>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
            </OutlinedSelect>
            <div>
              <OutlinedInput
                label="Next Link Condition Parameter"
                value={
                  pagination?.type === 'link'
                    ? (pagination.nextLinkCondition?.param ??
                      linkConditionParamDraft)
                    : ''
                }
                onChange={e => handleLinkConditionParamChange(e.target.value)}
                placeholder="results"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Optional. Only follow the next link when this link parameter
                matches the condition below.
              </p>
            </div>
            <OutlinedSelect
              label="Next Link Condition Operator"
              value={
                pagination?.type === 'link'
                  ? pagination.nextLinkCondition?.notEquals !== undefined
                    ? 'notEquals'
                    : pagination.nextLinkCondition?.equals !== undefined
                      ? 'equals'
                      : 'none'
                  : 'none'
              }
              onValueChange={value =>
                handleLinkConditionOperatorChange(
                  value as 'none' | 'equals' | 'notEquals',
                )
              }
            >
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="equals">Equals</SelectItem>
              <SelectItem value="notEquals">Does Not Equal</SelectItem>
            </OutlinedSelect>
            <OutlinedInput
              label="Next Link Condition Value"
              value={
                pagination?.type === 'link'
                  ? (pagination.nextLinkCondition?.equals ??
                    pagination.nextLinkCondition?.notEquals ??
                    '')
                  : ''
              }
              onChange={e => handleLinkConditionValueChange(e.target.value)}
              placeholder="true"
            />
          </>
        )}

        {showPaginationConfig && paginationType === 'graphql-cursor' && (
          <>
            {showCursorSuggestion && cursorSuggestion && (
              <Alert variant="info">
                <AlertDescription>
                  <p className="mb-2">We can derive these from your query:</p>
                  <ul className="mb-3 list-disc space-y-0.5 pl-5 text-xs">
                    <li>
                      <code>cursorVariable</code>:{' '}
                      <code>{cursorSuggestion.cursorVariable}</code>
                    </li>
                    <li>
                      <code>nextCursorExpression</code>:{' '}
                      <code>{cursorSuggestion.nextCursorExpression}</code>
                    </li>
                    {cursorSuggestion.hasNextPageExpression && (
                      <li>
                        <code>hasNextPageExpression</code>:{' '}
                        <code>{cursorSuggestion.hasNextPageExpression}</code>
                      </li>
                    )}
                  </ul>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onChange({
                        type: 'graphql-cursor',
                        ...cursorSuggestion,
                      })
                    }
                  >
                    Apply suggestion
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <div>
              <OutlinedInput
                label="Cursor Variable"
                value={
                  pagination?.type === 'graphql-cursor'
                    ? pagination.cursorVariable
                    : 'after'
                }
                onChange={e =>
                  handleFieldChange('cursorVariable', e.target.value)
                }
                placeholder="after"
              />
              {cursorVariableError && (
                <p className="mt-1 text-xs text-destructive" role="alert">
                  {cursorVariableError}
                </p>
              )}
            </div>
            <div>
              <OutlinedInput
                label="Next Cursor Expression"
                value={
                  pagination?.type === 'graphql-cursor'
                    ? pagination.nextCursorExpression
                    : ''
                }
                onChange={e =>
                  handleFieldChange('nextCursorExpression', e.target.value)
                }
                placeholder="data.organization.membersWithRole.pageInfo.endCursor"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                JSONata expression to extract the next cursor from the response
              </p>
            </div>
            <div>
              <OutlinedInput
                label="Has Next Page Expression"
                value={
                  pagination?.type === 'graphql-cursor'
                    ? (pagination.hasNextPageExpression ?? '')
                    : ''
                }
                onChange={e =>
                  handleFieldChange('hasNextPageExpression', e.target.value)
                }
                placeholder="data.organization.membersWithRole.pageInfo.hasNextPage"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Optional. If provided, pagination stops when this expression
                evaluates to false.
              </p>
            </div>
          </>
        )}

        {showPaginationConfig && paginationType === 'body-link' && (
          <>
            <Alert variant="info">
              <AlertDescription>
                Body link pagination extracts the next page URL from the
                response body using a JSONata expression (e.g., Snyk API,
                JSON:API format).
              </AlertDescription>
            </Alert>
            <div>
              <OutlinedInput
                label="Next Link Expression"
                value={
                  pagination?.type === 'body-link'
                    ? pagination.nextLinkExpression
                    : ''
                }
                onChange={e =>
                  handleFieldChange('nextLinkExpression', e.target.value)
                }
                placeholder="links.next"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                JSONata expression to extract next page URL from response body
              </p>
            </div>
            <div>
              <OutlinedInput
                label="Page Size Query Parameter"
                value={
                  pagination?.type === 'body-link'
                    ? (pagination.perPageParam ?? 'per_page')
                    : 'per_page'
                }
                onChange={e =>
                  handleFieldChange('perPageParam', e.target.value)
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Query parameter name for items per page (optional)
              </p>
            </div>
            <div>
              <OutlinedNumberInput
                label="Items Per Page"
                value={String(
                  pagination?.type === 'body-link'
                    ? (pagination.perPage ?? 100)
                    : 100,
                )}
                onChange={val => {
                  const parsed = parseInt(val, 10);
                  handleFieldChange('perPage', parsed > 0 ? parsed : 1);
                }}
                min={1}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Must be greater than 0
              </p>
            </div>
            <OutlinedSelect
              label="Follow-up Request Method"
              value={
                pagination?.type === 'body-link'
                  ? (pagination.nextRequestMethod ?? 'inherit')
                  : 'inherit'
              }
              onValueChange={value =>
                handleNextRequestMethodChange(
                  value as 'inherit' | 'GET' | 'POST',
                )
              }
            >
              <SelectItem value="inherit">Inherit Initial Method</SelectItem>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
            </OutlinedSelect>
          </>
        )}
      </div>
    </div>
  );
}
