import { JsonValue } from '@roadiehq/types';

export type IntegrationPaginationHint =
  | {
      type: 'cursor';
      cursorParam: string;
    }
  | {
      type: 'link';
      perPageParam?: string;
      perPage?: number;
    }
  | {
      type: 'page';
      pageParam: string;
      perPageParam?: string;
      perPage?: number;
      startPage?: number;
    }
  | {
      type: 'offset';
      offsetParam: string;
      limitParam: string;
      limit?: number;
    };

export type IntegrationPaginationDefault =
  | {
      type: 'none';
    }
  | {
      type: 'cursor';
      cursorParam: string;
      nextCursorExpression: string;
      paramLocation?: 'query' | 'body';
      bodyParamsPath?: string;
    }
  | {
      type: 'page';
      pageParam: string;
      perPageParam: string;
      perPage: number;
      startPage?: number;
    }
  | {
      type: 'offset';
      offsetParam: string;
      limitParam: string;
      limit: number;
      paramLocation?: 'query' | 'body';
      bodyParamsPath?: string;
      totalExpression?: string;
    }
  | {
      type: 'link';
      perPageParam?: string;
      perPage?: number;
      nextRequestMethod?: 'GET' | 'POST';
      nextLinkCondition?: {
        param: string;
        equals?: string;
        notEquals?: string;
      };
    }
  | {
      type: 'body-link';
      nextLinkExpression: string;
      perPageParam?: string;
      perPage?: number;
      nextRequestMethod?: 'GET' | 'POST';
    }
  | {
      type: 'graphql-cursor';
      cursorVariable: string;
      nextCursorExpression: string;
      hasNextPageExpression?: string;
    };

export interface IntegrationSchemaRow {
  id: string;
  integration_id: string;
  path_pattern: string;
  method: string;
  json_schema: unknown;
  source_type: string;
  is_override: boolean;
  spec_url: string | null;
  description: string | null;
  pagination_hint: unknown | null;
  pagination_default: unknown | null;
  created_at: Date;
  updated_at: Date;
}

export interface IntegrationSpecUrlRow {
  id: string;
  integration_id: string;
  spec_url: string;
  spec_format: string;
  processed_at: Date | null;
  attempt_count: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface IntegrationSchema {
  id: string;
  integrationId: string;
  integrationName?: string;
  pathPattern: string;
  method: string;
  jsonSchema: JsonValue;
  sourceType: 'spec' | 'inferred';
  isOverride: boolean;
  specUrl?: string;
  description?: string;
  paginationHint?: IntegrationPaginationHint;
  paginationDefault?: IntegrationPaginationDefault;
  effectivePaginationDefault?: IntegrationPaginationDefault;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationSpecUrl {
  id: string;
  integrationId: string;
  specUrl: string;
  specFormat: 'openapi' | 'asyncapi';
  processedAt: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIntegrationSchemaInput {
  integrationId: string;
  pathPattern: string;
  method?: string;
  jsonSchema: JsonValue;
  sourceType: 'spec' | 'inferred';
  isOverride?: boolean;
  specUrl?: string;
  description?: string;
  paginationHint?: IntegrationPaginationHint;
  paginationDefault?: IntegrationPaginationDefault;
}

export interface UpdateIntegrationSchemaInput {
  pathPattern?: string;
  method?: string;
  jsonSchema?: JsonValue;
  sourceType?: 'spec' | 'inferred';
  isOverride?: boolean;
  description?: string;
  paginationHint?: IntegrationPaginationHint;
  paginationDefault?: IntegrationPaginationDefault;
}

export interface CreateIntegrationSpecUrlInput {
  integrationId: string;
  specUrl: string;
  specFormat?: 'openapi' | 'asyncapi';
}

export interface UpdateIntegrationSpecUrlInput {
  specUrl?: string;
  specFormat?: 'openapi' | 'asyncapi';
}
