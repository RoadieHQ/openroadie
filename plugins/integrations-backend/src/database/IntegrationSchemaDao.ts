import { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { NotFoundError } from '@roadiehq/errors';
import { LoggerService } from '@roadiehq/extensions-api';
import { JsonValue } from '@roadiehq/types';
import { DateTime } from 'luxon';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import {
  IntegrationSchemaRow,
  IntegrationSpecUrlRow,
  IntegrationSchema,
  IntegrationSpecUrl,
  CreateIntegrationSchemaInput,
  UpdateIntegrationSchemaInput,
  CreateIntegrationSpecUrlInput,
  UpdateIntegrationSpecUrlInput,
  IntegrationPaginationHint,
  IntegrationPaginationDefault,
} from './schemaTypes';

const SCHEMAS_TABLE = 'integration_schemas';
const SPEC_URLS_TABLE = 'integration_spec_urls';

function schemaRowToEntity(
  row: IntegrationSchemaRow,
  integrationName?: string,
): IntegrationSchema {
  const paginationHint = parsePaginationHint(row.pagination_hint);
  const paginationDefault = parsePaginationDefault(row.pagination_default);
  return {
    id: row.id,
    integrationId: row.integration_id,
    integrationName,
    pathPattern: row.path_pattern,
    method: row.method,
    jsonSchema:
      typeof row.json_schema === 'string'
        ? JSON.parse(row.json_schema)
        : row.json_schema,
    sourceType: row.source_type as 'spec' | 'inferred',
    isOverride: row.is_override,
    specUrl: row.spec_url ?? undefined,
    description: row.description ?? undefined,
    paginationHint,
    paginationDefault,
    effectivePaginationDefault: resolveEffectivePaginationDefault(
      paginationHint,
      paginationDefault,
    ),
    createdAt: DateTime.fromJSDate(row.created_at).toISO()!,
    updatedAt: DateTime.fromJSDate(row.updated_at).toISO()!,
  };
}

function specUrlRowToEntity(row: IntegrationSpecUrlRow): IntegrationSpecUrl {
  return {
    id: row.id,
    integrationId: row.integration_id,
    specUrl: row.spec_url,
    specFormat: row.spec_format as 'openapi' | 'asyncapi',
    processedAt: row.processed_at
      ? DateTime.fromJSDate(row.processed_at).toISO()!
      : null,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    createdAt: DateTime.fromJSDate(row.created_at).toISO()!,
    updatedAt: DateTime.fromJSDate(row.updated_at).toISO()!,
  };
}

function parseJsonSchema(value: unknown): Record<string, JsonValue> {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return (parsed ?? {}) as Record<string, JsonValue>;
}

function deepMergeSchemas(
  base: Record<string, JsonValue>,
  override: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMergeSchemas(
        result[key] as Record<string, JsonValue>,
        value as Record<string, JsonValue>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function parsePaginationHint(
  value: unknown,
): IntegrationPaginationHint | undefined {
  if (typeof value === 'string') {
    return JSON.parse(value) as IntegrationPaginationHint;
  }
  return (value as IntegrationPaginationHint | null) ?? undefined;
}

function parsePaginationDefault(
  value: unknown,
): IntegrationPaginationDefault | undefined {
  if (typeof value === 'string') {
    return JSON.parse(value) as IntegrationPaginationDefault;
  }
  return (value as IntegrationPaginationDefault | null) ?? undefined;
}

function paginationDefaultFromHint(
  hint?: IntegrationPaginationHint,
): IntegrationPaginationDefault | undefined {
  if (!hint) {
    return undefined;
  }
  if (hint.type === 'cursor') {
    return {
      type: 'cursor',
      cursorParam: hint.cursorParam,
      nextCursorExpression: 'next_cursor',
    };
  }
  if (hint.type === 'page') {
    return {
      type: 'page',
      pageParam: hint.pageParam,
      perPageParam: hint.perPageParam ?? 'per_page',
      perPage: hint.perPage ?? 100,
      startPage: hint.startPage ?? 1,
    };
  }
  if (hint.type === 'link') {
    return {
      type: 'link',
      perPageParam: hint.perPageParam ?? 'per_page',
      perPage: hint.perPage ?? 100,
    };
  }
  return {
    type: 'offset',
    offsetParam: hint.offsetParam,
    limitParam: hint.limitParam,
    limit: hint.limit ?? 100,
  };
}

function resolveEffectivePaginationDefault(
  paginationHint?: IntegrationPaginationHint,
  paginationDefault?: IntegrationPaginationDefault,
): IntegrationPaginationDefault | undefined {
  return paginationDefault ?? paginationDefaultFromHint(paginationHint);
}

export class IntegrationSchemaDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;

  constructor(options: { knex: Knex; logger: LoggerService }) {
    this.knex = options.knex;
    this.logger = options.logger.child({ name: 'IntegrationSchemaDao' });
  }

  private schemasTable(trx?: Knex) {
    return (trx || this.knex)<IntegrationSchemaRow>(SCHEMAS_TABLE);
  }

  private specUrlsTable(trx?: Knex) {
    return (trx || this.knex)<IntegrationSpecUrlRow>(SPEC_URLS_TABLE);
  }

  private async assertIntegrationInWorkspace(
    integrationId: string,
    workspaceId: string,
  ): Promise<void> {
    const integration = await this.knex('integrations')
      .select('id')
      .where({ id: integrationId, workspace_id: workspaceId })
      .first();
    if (!integration) {
      throw new NotFoundError(`Integration not found: ${integrationId}`);
    }
  }

  private normalizePath(value: string): string {
    try {
      const parsed = new URL(value, 'http://placeholder');
      const normalized =
        parsed.pathname.length > 1
          ? parsed.pathname.replace(/\/+$/, '')
          : parsed.pathname;
      return normalized || '/';
    } catch {
      const [withoutQuery] = value.split('?');
      let end = withoutQuery.length;
      while (end > 1 && withoutQuery[end - 1] === '/') {
        end--;
      }
      return withoutQuery.slice(0, end) || '/';
    }
  }

  private isPathPlaceholderSegment(segment: string): boolean {
    return /^\{[^/{}]+\}$/.test(segment);
  }

  private getPathSegments(value: string): string[] {
    return this.normalizePath(value)
      .split('/')
      .filter(segment => segment !== '');
  }

  private matchesTemplatePath(
    pathTemplate: string,
    concretePath: string,
  ): boolean {
    const templateSegments = this.getPathSegments(pathTemplate);
    const concreteSegments = this.getPathSegments(concretePath);

    if (templateSegments.length !== concreteSegments.length) {
      return false;
    }

    const candidateHasTemplateParams = concreteSegments.some(segment =>
      this.isPathPlaceholderSegment(segment),
    );
    const lastSegmentIndex = templateSegments.length - 1;

    for (let i = 0; i < templateSegments.length; i++) {
      const templateSegment = templateSegments[i];
      const concreteSegment = concreteSegments[i];
      const templateIsPlaceholder =
        this.isPathPlaceholderSegment(templateSegment);
      const concreteIsPlaceholder =
        this.isPathPlaceholderSegment(concreteSegment);

      if (templateIsPlaceholder) {
        if (
          candidateHasTemplateParams &&
          i === lastSegmentIndex &&
          concreteIsPlaceholder !== templateIsPlaceholder
        ) {
          return false;
        }
        continue;
      }

      if (concreteIsPlaceholder || templateSegment !== concreteSegment) {
        return false;
      }
    }

    return true;
  }

  private getLookupPathCandidates(pathPattern: string): string[] {
    const candidates = [pathPattern];
    const normalized = this.normalizePath(pathPattern);
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
    return candidates;
  }

  private getPatternSpecificity(pathPattern: string): number {
    return this.getPathSegments(pathPattern)
      .filter(segment => !this.isPathPlaceholderSegment(segment))
      .join('/').length;
  }

  private getPatternMatchScore(
    pathPattern: string,
    pathCandidates: string[],
  ): number {
    const patternSegments = this.getPathSegments(pathPattern);
    if (patternSegments.length === 0) {
      return 0;
    }

    let bestScore = 0;
    for (const candidate of pathCandidates) {
      const candidateSegments = this.getPathSegments(candidate);
      if (patternSegments.length !== candidateSegments.length) {
        continue;
      }

      let staticMatches = 0;
      for (let i = 0; i < patternSegments.length; i++) {
        const patternSegment = patternSegments[i];
        const candidateSegment = candidateSegments[i];
        if (
          !this.isPathPlaceholderSegment(patternSegment) &&
          !this.isPathPlaceholderSegment(candidateSegment) &&
          patternSegment === candidateSegment
        ) {
          staticMatches += 1;
        }
      }

      const patternLast = patternSegments[patternSegments.length - 1];
      const candidateLast = candidateSegments[candidateSegments.length - 1];
      const hasMatchingStaticTail =
        !this.isPathPlaceholderSegment(patternLast) &&
        !this.isPathPlaceholderSegment(candidateLast) &&
        patternLast === candidateLast;

      const score = staticMatches * 10 + (hasMatchingStaticTail ? 100 : 0);
      if (score > bestScore) {
        bestScore = score;
      }
    }

    return bestScore;
  }

  private getMatchedPathPatterns(
    rows: IntegrationSchemaRow[],
    pathCandidates: string[],
  ): string[] {
    const uniquePatterns = rows
      .map(row => row.path_pattern)
      .filter((value, index, array) => array.indexOf(value) === index);

    return uniquePatterns.filter(pattern =>
      pathCandidates.some(
        candidate =>
          pattern === candidate ||
          this.normalizePath(pattern) === this.normalizePath(candidate) ||
          this.matchesTemplatePath(pattern, candidate),
      ),
    );
  }

  private selectBestMatchedPattern(
    matchedPatterns: string[],
    rows: IntegrationSchemaRow[],
    pathCandidates: string[],
  ): string | undefined {
    if (matchedPatterns.length === 0) {
      return undefined;
    }

    const normalizedCandidates = pathCandidates.map(candidate =>
      this.normalizePath(candidate),
    );

    return matchedPatterns.sort((a, b) => {
      const rowsForA = rows.filter(row => row.path_pattern === a);
      const rowsForB = rows.filter(row => row.path_pattern === b);
      const hasSpecA = rowsForA.some(row => row.source_type === 'spec');
      const hasSpecB = rowsForB.some(row => row.source_type === 'spec');
      if (hasSpecA !== hasSpecB) {
        return hasSpecB ? 1 : -1;
      }

      const isExactA = normalizedCandidates.includes(this.normalizePath(a));
      const isExactB = normalizedCandidates.includes(this.normalizePath(b));
      if (isExactA !== isExactB) {
        return isExactB ? 1 : -1;
      }

      const matchScoreA = this.getPatternMatchScore(a, pathCandidates);
      const matchScoreB = this.getPatternMatchScore(b, pathCandidates);
      if (matchScoreA !== matchScoreB) {
        return matchScoreB - matchScoreA;
      }

      return this.getPatternSpecificity(b) - this.getPatternSpecificity(a);
    })[0];
  }

  async listSchemas(options?: {
    workspaceId?: string;
    integrationId?: string;
    pathPattern?: string;
    pathSearch?: string;
    method?: string;
    sourceType?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ schemas: IntegrationSchema[]; total: number }> {
    const {
      integrationId,
      workspaceId = DEFAULT_WORKSPACE_ID,
      pathPattern,
      pathSearch,
      method,
      sourceType,
      limit = 50,
      offset = 0,
    } = options ?? {};

    let query = this.schemasTable().join(
      'integrations',
      'integration_schemas.integration_id',
      'integrations.id',
    );
    query = query.where('integrations.workspace_id', workspaceId);

    if (integrationId) {
      query = query.where('integration_schemas.integration_id', integrationId);
    }
    if (pathPattern) {
      query = query.where('path_pattern', pathPattern);
    }
    if (pathSearch) {
      query = query.whereRaw('LOWER(path_pattern) LIKE ?', [
        `%${pathSearch.toLowerCase()}%`,
      ]);
    }
    if (method) {
      query = query.where('method', method.toUpperCase());
    }
    if (sourceType) {
      query = query.where('source_type', sourceType);
    }

    const countResult = await query.clone().count('* as total').first();
    const total = Number(countResult?.total ?? 0);

    const rows = await query
      .select('integration_schemas.*', 'integrations.name as integration_name')
      .orderBy('integration_schemas.updated_at', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      schemas: rows.map(row =>
        schemaRowToEntity(
          row as IntegrationSchemaRow,
          (row as IntegrationSchemaRow & { integration_name?: string })
            .integration_name,
        ),
      ),
      total,
    };
  }

  async getSchemaWithOverrides(
    integrationId: string,
    pathPattern: string,
    method: string = 'GET',
    workspaceId: string = DEFAULT_WORKSPACE_ID,
  ): Promise<IntegrationSchema | undefined> {
    const pathCandidates = this.getLookupPathCandidates(pathPattern);
    const allRows = await this.schemasTable()
      .join(
        'integrations',
        'integration_schemas.integration_id',
        'integrations.id',
      )
      .select('integration_schemas.*')
      .where('integration_schemas.integration_id', integrationId)
      .andWhere('integrations.workspace_id', workspaceId)
      .andWhere('integration_schemas.method', method.toUpperCase())
      .orderBy('integration_schemas.is_override', 'asc')
      .orderBy('integration_schemas.created_at', 'asc');
    const matchedPatterns = this.getMatchedPathPatterns(
      allRows,
      pathCandidates,
    );
    const matchedPathPattern = this.selectBestMatchedPattern(
      matchedPatterns,
      allRows,
      pathCandidates,
    );

    if (!matchedPathPattern) {
      return undefined;
    }

    const rows = allRows.filter(r => r.path_pattern === matchedPathPattern);

    if (rows.length === 0) {
      return undefined;
    }

    const base = rows.find(r => !r.is_override);
    const overrides = rows
      .filter(r => r.is_override)
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    const effectiveRows = [...(base ? [base] : []), ...overrides];
    const paginationHint = [...effectiveRows]
      .reverse()
      .map(row => parsePaginationHint(row.pagination_hint))
      .find(value => value !== undefined);
    const paginationDefault = [...effectiveRows]
      .reverse()
      .map(row => parsePaginationDefault(row.pagination_default))
      .find(value => value !== undefined);
    const description = [...effectiveRows]
      .reverse()
      .map(row => row.description ?? undefined)
      .find(value => value !== undefined);

    if (!base && overrides.length > 0) {
      let merged = parseJsonSchema(overrides[0].json_schema);
      for (let i = 1; i < overrides.length; i++) {
        merged = deepMergeSchemas(
          merged,
          parseJsonSchema(overrides[i].json_schema),
        );
      }
      const latest = overrides[overrides.length - 1];
      return {
        ...schemaRowToEntity(latest),
        jsonSchema: merged,
        description,
        paginationHint,
        paginationDefault,
        effectivePaginationDefault: resolveEffectivePaginationDefault(
          paginationHint,
          paginationDefault,
        ),
      };
    }

    if (base && overrides.length === 0) {
      return schemaRowToEntity(base);
    }

    if (base && overrides.length > 0) {
      let merged = parseJsonSchema(base.json_schema);
      for (const override of overrides) {
        merged = deepMergeSchemas(
          merged,
          parseJsonSchema(override.json_schema),
        );
      }
      const latest = overrides[overrides.length - 1];
      return {
        ...schemaRowToEntity(base),
        id: latest.id,
        isOverride: true,
        jsonSchema: merged,
        description,
        paginationHint,
        paginationDefault,
        effectivePaginationDefault: resolveEffectivePaginationDefault(
          paginationHint,
          paginationDefault,
        ),
      };
    }

    return undefined;
  }

  async getSchemaById(
    id: string,
    workspaceId: string = DEFAULT_WORKSPACE_ID,
  ): Promise<IntegrationSchema> {
    const row = await this.schemasTable()
      .leftJoin(
        'integrations',
        'integration_schemas.integration_id',
        'integrations.id',
      )
      .select('integration_schemas.*', 'integrations.name as integration_name')
      .where('integration_schemas.id', id)
      .andWhere('integrations.workspace_id', workspaceId)
      .first();
    if (!row) {
      throw new NotFoundError(`Integration schema not found: ${id}`);
    }
    return schemaRowToEntity(
      row as IntegrationSchemaRow,
      (row as IntegrationSchemaRow & { integration_name?: string })
        .integration_name,
    );
  }

  async createSchema(
    input: CreateIntegrationSchemaInput,
    workspaceId: string = DEFAULT_WORKSPACE_ID,
  ): Promise<IntegrationSchema> {
    await this.assertIntegrationInWorkspace(input.integrationId, workspaceId);
    const id = uuid();
    const now = new Date();

    const row: IntegrationSchemaRow = {
      id,
      integration_id: input.integrationId,
      path_pattern: input.pathPattern,
      method: input.method?.toUpperCase() ?? 'GET',
      json_schema: JSON.stringify(input.jsonSchema),
      source_type: input.sourceType,
      is_override: input.isOverride ?? false,
      spec_url: input.specUrl ?? null,
      description: input.description ?? null,
      pagination_hint: input.paginationHint
        ? JSON.stringify(input.paginationHint)
        : null,
      pagination_default: input.paginationDefault
        ? JSON.stringify(input.paginationDefault)
        : null,
      created_at: now,
      updated_at: now,
    };

    await this.schemasTable().insert(row);
    this.logger.info(
      `Created integration schema for ${input.integrationId} ${input.pathPattern}`,
    );

    return this.getSchemaById(id, workspaceId);
  }

  async updateSchema(
    id: string,
    input: UpdateIntegrationSchemaInput,
    workspaceId: string = DEFAULT_WORKSPACE_ID,
  ): Promise<IntegrationSchema> {
    await this.getSchemaById(id, workspaceId);

    const updates: Partial<IntegrationSchemaRow> = {
      updated_at: new Date(),
    };

    if (input.jsonSchema !== undefined) {
      updates.json_schema = JSON.stringify(input.jsonSchema);
    }
    if (input.pathPattern !== undefined) {
      updates.path_pattern = input.pathPattern;
    }
    if (input.method !== undefined) {
      updates.method = input.method.toUpperCase();
    }
    if (input.sourceType !== undefined) {
      updates.source_type = input.sourceType;
    }
    if (input.isOverride !== undefined) {
      updates.is_override = input.isOverride;
    }
    if (input.description !== undefined) {
      updates.description = input.description;
    }
    if (input.paginationHint !== undefined) {
      updates.pagination_hint = JSON.stringify(input.paginationHint);
    }
    if (input.paginationDefault !== undefined) {
      updates.pagination_default = JSON.stringify(input.paginationDefault);
    }

    await this.schemasTable().where('id', id).update(updates);
    return this.getSchemaById(id, workspaceId);
  }

  async deleteSchema(
    id: string,
    workspaceId: string = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    const existing = await this.getSchemaById(id, workspaceId);
    await this.schemasTable().where('id', id).delete();
    this.logger.info(
      `Deleted integration schema for ${existing.integrationId} ${existing.pathPattern}`,
    );
  }

  async upsertSchemaFromSpec(
    integrationId: string,
    pathPattern: string,
    method: string,
    jsonSchema: JsonValue,
    specUrl: string,
    description?: string,
    paginationHint?: IntegrationPaginationHint,
  ): Promise<void> {
    const upperMethod = method.toUpperCase();
    const existing = await this.schemasTable()
      .where('integration_id', integrationId)
      .andWhere('path_pattern', pathPattern)
      .andWhere('method', upperMethod)
      .andWhere('is_override', false)
      .first();

    const now = new Date();

    if (existing) {
      await this.schemasTable()
        .where('id', existing.id)
        .update({
          json_schema: JSON.stringify(jsonSchema),
          source_type: 'spec',
          spec_url: specUrl,
          description: description ?? existing.description,
          pagination_hint:
            paginationHint !== undefined
              ? JSON.stringify(paginationHint)
              : existing.pagination_hint,
          pagination_default: existing.pagination_default,
          updated_at: now,
        });
    } else {
      await this.schemasTable().insert({
        id: uuid(),
        integration_id: integrationId,
        path_pattern: pathPattern,
        method: upperMethod,
        json_schema: JSON.stringify(jsonSchema),
        source_type: 'spec',
        is_override: false,
        spec_url: specUrl,
        description: description ?? null,
        pagination_hint: paginationHint ? JSON.stringify(paginationHint) : null,
        pagination_default: null,
        created_at: now,
        updated_at: now,
      });
    }
  }

  async upsertSchemaFromInference(
    integrationId: string,
    pathPattern: string,
    method: string = 'GET',
    jsonSchema: JsonValue,
  ): Promise<void> {
    const upperMethod = method.toUpperCase();
    const existingSpec = await this.schemasTable()
      .where('integration_id', integrationId)
      .andWhere('path_pattern', pathPattern)
      .andWhere('method', upperMethod)
      .andWhere('source_type', 'spec')
      .andWhere('is_override', false)
      .first();

    if (existingSpec) {
      return;
    }

    const existing = await this.schemasTable()
      .where('integration_id', integrationId)
      .andWhere('path_pattern', pathPattern)
      .andWhere('method', upperMethod)
      .andWhere('is_override', false)
      .first();

    const now = new Date();

    if (existing) {
      await this.schemasTable()
        .where('id', existing.id)
        .update({
          json_schema: JSON.stringify(jsonSchema),
          source_type: 'inferred',
          updated_at: now,
        });
    } else {
      await this.schemasTable().insert({
        id: uuid(),
        integration_id: integrationId,
        path_pattern: pathPattern,
        method: upperMethod,
        json_schema: JSON.stringify(jsonSchema),
        source_type: 'inferred',
        is_override: false,
        spec_url: null,
        pagination_default: null,
        created_at: now,
        updated_at: now,
      });
    }
  }

  async listSpecUrls(options?: {
    workspaceId?: string;
    integrationId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ specUrls: IntegrationSpecUrl[]; total: number }> {
    const {
      integrationId,
      workspaceId = DEFAULT_WORKSPACE_ID,
      limit = 50,
      offset = 0,
    } = options ?? {};

    let query = this.specUrlsTable()
      .join(
        'integrations',
        'integration_spec_urls.integration_id',
        'integrations.id',
      )
      .where('integrations.workspace_id', workspaceId);

    if (integrationId) {
      query = query.where(
        'integration_spec_urls.integration_id',
        integrationId,
      );
    }

    const countResult = (await query.clone().count('* as total').first()) as
      | { total: string | number }
      | undefined;
    const total = Number(countResult?.total ?? 0);

    const rows = await query
      .select('integration_spec_urls.*')
      .orderBy('integration_spec_urls.updated_at', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      specUrls: rows.map(specUrlRowToEntity),
      total,
    };
  }

  async getSpecUrlById(
    id: string,
    workspaceId: string = DEFAULT_WORKSPACE_ID,
  ): Promise<IntegrationSpecUrl> {
    const row = await this.specUrlsTable()
      .join(
        'integrations',
        'integration_spec_urls.integration_id',
        'integrations.id',
      )
      .select('integration_spec_urls.*')
      .where('integration_spec_urls.id', id)
      .andWhere('integrations.workspace_id', workspaceId)
      .first();
    if (!row) {
      throw new NotFoundError(`Integration spec URL not found: ${id}`);
    }
    return specUrlRowToEntity(row);
  }

  async createSpecUrl(
    input: CreateIntegrationSpecUrlInput,
    workspaceId: string = DEFAULT_WORKSPACE_ID,
  ): Promise<IntegrationSpecUrl> {
    await this.assertIntegrationInWorkspace(input.integrationId, workspaceId);
    const id = uuid();
    const now = new Date();

    const row: IntegrationSpecUrlRow = {
      id,
      integration_id: input.integrationId,
      spec_url: input.specUrl,
      spec_format: input.specFormat ?? 'openapi',
      processed_at: null,
      attempt_count: 0,
      last_error: null,
      created_at: now,
      updated_at: now,
    };

    await this.specUrlsTable().insert(row);
    this.logger.info(
      `Created spec URL for ${input.integrationId}: ${input.specUrl}`,
    );

    return this.getSpecUrlById(id, workspaceId);
  }

  async updateSpecUrl(
    id: string,
    input: UpdateIntegrationSpecUrlInput,
    workspaceId: string = DEFAULT_WORKSPACE_ID,
  ): Promise<{ specUrl: IntegrationSpecUrl; urlChanged: boolean }> {
    const existing = await this.getSpecUrlById(id, workspaceId);

    const urlChanged =
      input.specUrl !== undefined && input.specUrl !== existing.specUrl;

    const updates: Partial<IntegrationSpecUrlRow> = {
      updated_at: new Date(),
    };

    if (input.specUrl !== undefined) {
      updates.spec_url = input.specUrl;
    }
    if (input.specFormat !== undefined) {
      updates.spec_format = input.specFormat;
    }

    if (urlChanged) {
      updates.processed_at = null;
      updates.attempt_count = 0;
      updates.last_error = null;
    }

    await this.specUrlsTable().where('id', id).update(updates);
    return {
      specUrl: await this.getSpecUrlById(id, workspaceId),
      urlChanged,
    };
  }

  async deleteSpecUrl(
    id: string,
    workspaceId: string = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    const existing = await this.getSpecUrlById(id, workspaceId);
    await this.specUrlsTable().where('id', id).delete();
    this.logger.info(
      `Deleted spec URL for ${existing.integrationId}: ${existing.specUrl}`,
    );
  }

  async listPathSuggestions(
    integrationId: string,
    method?: string,
    workspaceId: string = DEFAULT_WORKSPACE_ID,
  ): Promise<
    {
      pathPattern: string;
      method: string;
      description: string | null;
      paginationHint?: IntegrationPaginationHint;
      paginationDefault?: IntegrationPaginationDefault;
      effectivePaginationDefault?: IntegrationPaginationDefault;
    }[]
  > {
    let query = this.schemasTable()
      .join(
        'integrations',
        'integration_schemas.integration_id',
        'integrations.id',
      )
      .where('integration_schemas.integration_id', integrationId)
      .andWhere('integrations.workspace_id', workspaceId);

    if (method) {
      query = query.andWhere(
        'integration_schemas.method',
        method.toUpperCase(),
      );
    }

    const rows = await query
      .select(
        'integration_schemas.path_pattern',
        'integration_schemas.method',
        'integration_schemas.description',
        'integration_schemas.pagination_hint',
        'integration_schemas.pagination_default',
        'integration_schemas.is_override',
        'integration_schemas.created_at',
      )
      .orderBy('integration_schemas.method', 'asc')
      .orderBy('integration_schemas.path_pattern', 'asc');

    const groupedRows = new Map<string, IntegrationSchemaRow[]>();
    for (const row of rows as IntegrationSchemaRow[]) {
      const key = `${row.method}:${row.path_pattern}`;
      const existing = groupedRows.get(key);
      if (existing) {
        existing.push(row);
      } else {
        groupedRows.set(key, [row]);
      }
    }

    return [...groupedRows.values()].map(group => {
      const orderedGroup = [...group].sort((a, b) => {
        if (a.is_override !== b.is_override) {
          return a.is_override ? 1 : -1;
        }
        return (
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });
      const latestRows = [...orderedGroup].reverse();
      const paginationHint = latestRows
        .map(row => parsePaginationHint(row.pagination_hint))
        .find(value => value !== undefined);
      const paginationDefault = latestRows
        .map(row => parsePaginationDefault(row.pagination_default))
        .find(value => value !== undefined);
      const description =
        latestRows
          .map(row => row.description ?? undefined)
          .find(value => value !== undefined) ?? null;
      const [first] = orderedGroup;

      return {
        pathPattern: first.path_pattern,
        method: first.method,
        description,
        paginationHint,
        paginationDefault,
        effectivePaginationDefault: resolveEffectivePaginationDefault(
          paginationHint,
          paginationDefault,
        ),
      };
    });
  }

  async getAllSpecUrls(): Promise<IntegrationSpecUrl[]> {
    const rows = await this.specUrlsTable().orderBy('integration_id', 'asc');
    return rows.map(specUrlRowToEntity);
  }

  async getProcessableSpecUrls(
    maxAttempts: number,
  ): Promise<IntegrationSpecUrl[]> {
    const rows = await this.specUrlsTable()
      .whereNull('processed_at')
      .andWhere('attempt_count', '<', maxAttempts)
      .orderBy('created_at', 'asc');
    return rows.map(specUrlRowToEntity);
  }

  async incrementAttemptCount(id: string): Promise<void> {
    const updateData: { attempt_count: Knex.Raw; updated_at: Date } = {
      attempt_count: this.knex.raw('attempt_count + 1'),
      updated_at: new Date(),
    };
    await this.specUrlsTable().where('id', id).update(updateData);
  }

  async markSpecUrlProcessed(id: string): Promise<void> {
    await this.specUrlsTable().where('id', id).update({
      processed_at: new Date(),
      attempt_count: 0,
      last_error: null,
      updated_at: new Date(),
    });
  }

  async markSpecUrlFailed(id: string, errorMessage: string): Promise<void> {
    await this.specUrlsTable()
      .where('id', id)
      .update({
        last_error: errorMessage.slice(0, 1024),
        updated_at: new Date(),
      });
  }
}
