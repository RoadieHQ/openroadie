import { mockServices } from '@roadiehq/backend-test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntegrationSpecUrl } from '../database/schemaTypes';
import { SchemaProcessor } from './SchemaProcessor';

const specUrl: IntegrationSpecUrl = {
  id: 'spec-1',
  integrationId: 'integration-1',
  specUrl: 'https://example.com/openapi.json',
  specFormat: 'openapi',
  processedAt: null,
  attemptCount: 0,
  lastError: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function createSchemaDao() {
  return {
    getProcessableSpecUrls: vi.fn(),
    incrementAttemptCount: vi.fn(),
    markSpecUrlProcessed: vi.fn(),
    markSpecUrlFailed: vi.fn(),
    upsertSchemaFromSpec: vi.fn(),
    upsertSchemaFromInference: vi.fn(),
  };
}

describe('SchemaProcessor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not fetch specs for a deleted workspace', async () => {
    const schemaDao = createSchemaDao();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const processor = new SchemaProcessor({
      schemaDao,
      logger: mockServices.logger.mock(),
      getWorkspaceIdForIntegration: vi.fn().mockResolvedValue('workspace-1'),
      workspaceExists: vi.fn().mockResolvedValue(false),
    });

    await processor.processSpecUrlWithTracking(specUrl);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(schemaDao.upsertSchemaFromSpec).not.toHaveBeenCalled();
    expect(schemaDao.markSpecUrlProcessed).toHaveBeenCalledWith(specUrl.id);
  });

  it('does not write schemas when the workspace is deleted during the fetch', async () => {
    const schemaDao = createSchemaDao();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            openapi: '3.0.0',
            info: { title: 'Example', version: '1.0.0' },
            paths: {
              '/users': {
                get: {
                  responses: {
                    '200': {
                      content: {
                        'application/json': {
                          schema: { type: 'array' },
                        },
                      },
                    },
                  },
                },
              },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const processor = new SchemaProcessor({
      schemaDao,
      logger: mockServices.logger.mock(),
      getWorkspaceIdForIntegration: vi.fn().mockResolvedValue('workspace-1'),
      workspaceExists: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    });

    await processor.processSpecUrlWithTracking(specUrl);

    expect(schemaDao.upsertSchemaFromSpec).not.toHaveBeenCalled();
    expect(schemaDao.markSpecUrlProcessed).toHaveBeenCalledWith(specUrl.id);
  });
});
