import SwaggerParser from '@apidevtools/swagger-parser';
import { LoggerService } from '@roadiehq/extensions-api';
import { JsonValue } from '@roadiehq/types';
import { IntegrationSchemaDao } from '../database/IntegrationSchemaDao';
import { IntegrationSpecUrl } from '../database/schemaTypes';
import { SpecParser } from './types';
import { OpenApiSpecParser } from './OpenApiSpecParser';

const MAX_ATTEMPTS = 3;
const MAX_SPEC_SIZE_BYTES = 20 * 1024 * 1024;
const SKIP_DEREFERENCE_THRESHOLD_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;

type SchemaProcessorDao = Pick<
  IntegrationSchemaDao,
  | 'getProcessableSpecUrls'
  | 'incrementAttemptCount'
  | 'markSpecUrlProcessed'
  | 'markSpecUrlFailed'
  | 'upsertSchemaFromSpec'
  | 'upsertSchemaFromInference'
>;

export class SchemaProcessor {
  private readonly schemaDao: SchemaProcessorDao;
  private readonly logger: LoggerService;
  private readonly parsers: SpecParser[];
  private readonly getWorkspaceIdForIntegration: (
    integrationId: string,
  ) => Promise<string | undefined>;
  private readonly workspaceExists: (workspaceId: string) => Promise<boolean>;

  constructor(options: {
    schemaDao: SchemaProcessorDao;
    logger: LoggerService;
    getWorkspaceIdForIntegration: (
      integrationId: string,
    ) => Promise<string | undefined>;
    workspaceExists: (workspaceId: string) => Promise<boolean>;
  }) {
    this.schemaDao = options.schemaDao;
    this.logger = options.logger.child({ name: 'SchemaProcessor' });
    this.parsers = [new OpenApiSpecParser()];
    this.getWorkspaceIdForIntegration = options.getWorkspaceIdForIntegration;
    this.workspaceExists = options.workspaceExists;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  async processUnprocessedSpecs(): Promise<void> {
    const specUrls = await this.schemaDao.getProcessableSpecUrls(MAX_ATTEMPTS);

    this.logger.info(
      `Found ${specUrls.length} unprocessed integration spec URLs`,
    );

    let successCount = 0;
    let errorCount = 0;

    for (const specUrl of specUrls) {
      try {
        await this.processSpecUrlWithTracking(specUrl);
        successCount++;
      } catch (error) {
        errorCount++;
        this.logger.warn(
          `Failed to process spec for ${specUrl.integrationId} (${specUrl.specUrl}): ${error}`,
        );
      }
    }

    this.logger.info(
      `Schema processing complete: ${successCount} succeeded, ${errorCount} failed out of ${specUrls.length}`,
    );
  }

  async processSpecUrlWithTracking(specUrl: IntegrationSpecUrl): Promise<void> {
    await this.schemaDao.incrementAttemptCount(specUrl.id);

    try {
      await this.processSpecUrl(specUrl);
      await this.schemaDao.markSpecUrlProcessed(specUrl.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.schemaDao.markSpecUrlFailed(specUrl.id, message);
      throw error;
    }
  }

  private async processSpecUrl(specUrl: IntegrationSpecUrl): Promise<void> {
    const workspaceId = await this.getWorkspaceIdForIntegration(
      specUrl.integrationId,
    );
    if (!workspaceId || !(await this.workspaceExists(workspaceId))) {
      return;
    }

    this.logger.info(
      `Fetching spec for ${specUrl.integrationId}: ${specUrl.specUrl}`,
    );

    const specObj = await this.fetchAndDereference(specUrl.specUrl);

    const parser = this.parsers.find(p => p.canParse(specObj));
    if (!parser) {
      throw new Error(`No parser found for spec at ${specUrl.specUrl}`);
    }

    const schemas = parser.parse(specObj);

    if (!(await this.workspaceExists(workspaceId))) {
      return;
    }

    this.logger.info(
      `Parsed ${schemas.length} path schemas from ${specUrl.specUrl} for ${specUrl.integrationId}`,
    );

    for (const schema of schemas) {
      await this.schemaDao.upsertSchemaFromSpec(
        specUrl.integrationId,
        schema.pathPattern,
        schema.method,
        schema.jsonSchema,
        specUrl.specUrl,
        schema.description,
        schema.paginationHint,
      );
    }
  }

  async writeInferredSchema(
    integrationId: string,
    pathPattern: string,
    jsonSchema: JsonValue,
    method: string = 'GET',
  ): Promise<void> {
    await this.schemaDao.upsertSchemaFromInference(
      integrationId,
      pathPattern,
      method,
      jsonSchema,
    );
    this.logger.debug(
      `Wrote inferred schema for ${integrationId} ${pathPattern}`,
    );
  }

  private async fetchAndDereference(
    url: string,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      // eslint-disable-next-line no-restricted-syntax -- external target: a user-supplied remote schema URL, not an internal call.
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch spec from ${url}: ${response.status} ${response.statusText}`,
        );
      }

      const contentLengthHeader = response.headers.get('content-length');
      const contentLength = contentLengthHeader
        ? parseInt(contentLengthHeader, 10)
        : undefined;

      if (contentLength && contentLength > MAX_SPEC_SIZE_BYTES) {
        throw new Error(
          `Spec at ${url} is too large (${contentLength} bytes, limit ${MAX_SPEC_SIZE_BYTES}). Skipping.`,
        );
      }

      const skipDereference =
        contentLength !== undefined &&
        contentLength > SKIP_DEREFERENCE_THRESHOLD_BYTES;

      const contentType = response.headers.get('content-type') ?? '';
      let rawSpec: unknown;

      if (
        contentType.includes('yaml') ||
        contentType.includes('yml') ||
        url.endsWith('.yaml') ||
        url.endsWith('.yml')
      ) {
        const text = await response.text();
        const yaml = await import('js-yaml');
        rawSpec = yaml.load(text);
      } else {
        rawSpec = await response.json();
      }

      if (!this.isRecord(rawSpec)) {
        throw new Error(`Spec at ${url} is not an object`);
      }

      if (skipDereference) {
        this.logger.info(
          `Skipping SwaggerParser.dereference for large spec at ${url} (${contentLength} bytes)`,
        );
        return rawSpec;
      }

      const dereferenced = await SwaggerParser.dereference(rawSpec, {
        dereference: { circular: 'ignore' },
      });

      if (!this.isRecord(dereferenced)) {
        throw new Error(`Dereferenced spec at ${url} is not an object`);
      }

      return dereferenced;
    } finally {
      clearTimeout(timeout);
    }
  }
}
