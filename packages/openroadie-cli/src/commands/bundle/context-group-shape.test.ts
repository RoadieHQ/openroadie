import { describe, it, expect } from 'vitest';
import { bundleItemSchema, API_VERSION } from './format';
import { contextGroupToManifest } from './portable';
import type { SlugMaps } from './portable';
import { applyImportPlan, buildImportPlan } from './import';
import type { ContextGroupRow } from './api';
import type { ParsedBundle } from './import-parse';
import type { OpenRoadieConfig } from '../../config';
import { OpenRoadieHttpClient } from '../../http-client';

/**
 * Pins the context-group contract, which the rest of the suite cannot: every
 * other test builds `ContextGroupRow` by hand, so the CLI and its fixtures can
 * agree with each other while both disagree with the backend. That is exactly
 * what happened once — context groups carried `rootDatasources` +
 * `associatedDatasources` + `relationshipTypes` + `rootMergeRelationshipTypes`
 * until the associated-datasources removal collapsed them into `datasources` +
 * `mergeRelationshipTypes`. Nothing failed to compile; every context group
 * simply stopped exporting at runtime.
 *
 * `LIVE_CONTEXT_GROUP` is a verbatim response body, so a drift between the CLI
 * and this fixture fails here. A backend rename still has to be caught by
 * re-capturing the fixture (see the command below) — a unit test cannot see the
 * live API.
 *
 *   curl -s '<backend>/api/catalog-datastore/context-groups/rules?limit=2'
 *
 * Captured 2026-07-31 from GET /api/catalog-datastore/context-groups/rules.
 */
const LIVE_CONTEXT_GROUP = {
  id: '1acedcdd-7c01-42a5-a957-0b63ea630174',
  name: 'ECR & GitHub',
  slug: 'ecr-github',
  description:
    'Each ECR repository grouped with its source GitHub repository and its images.',
  datasources: [
    {
      datasourceId: 'c495fe38-4a5e-4e07-a98e-0b236de73229',
      status: {
        live: true,
        datasourceId: 'c495fe38-4a5e-4e07-a98e-0b236de73229',
        displayName: 'ECR Repositories',
      },
    },
  ],
  mergeRelationshipTypes: [],
  annotations: [],
  includeExternalRelations: true,
  seedVersion: null,
  createdAt: '2026-07-03T15:16:20.114Z',
  updatedAt: '2026-07-06T09:19:48.395Z',
};

/**
 * Fields `ContextGroupsController.createRule` destructures from `req.body`.
 * Anything the importer sends outside this set is silently dropped by the API.
 */
const ACCEPTED_WRITE_FIELDS = [
  'name',
  'slug',
  'description',
  'datasources',
  'mergeRelationshipTypes',
  'annotations',
  'includeExternalRelations',
  'seedVersion',
];

const maps: SlugMaps = {
  datasourceSlugById: new Map([
    ['c495fe38-4a5e-4e07-a98e-0b236de73229', 'ecr-repositories'],
  ]),
  integrationSlugById: new Map<string, string>(),
  // Only the id→slug direction is exercised here; the reverse maps and the
  // name lookup are for import, which this test does not run.
  integrationIdBySlug: new Map<string, string>(),
  datasourceIdBySlug: new Map<string, string>(),
  datasourceSlugByName: new Map<string, string>(),
};

describe('context-group live shape', () => {
  it('the live payload satisfies the row type the exporter reads', () => {
    // Compiles only while ContextGroupRow matches the captured body.
    const row: ContextGroupRow = LIVE_CONTEXT_GROUP;
    expect(row.datasources).toHaveLength(1);
    expect(row.mergeRelationshipTypes).toEqual([]);
  });

  it('exports a live group to a manifest that parses back', () => {
    const manifest = contextGroupToManifest(LIVE_CONTEXT_GROUP, maps);
    const parsed = bundleItemSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.kind !== 'ContextGroup') {
      throw new Error('expected a ContextGroup item');
    }
    // The id→slug rewrite happened, and the derived `status` never travels.
    expect(parsed.data.spec.datasources).toEqual([
      { datasourceSlug: 'ecr-repositories' },
    ]);
    expect(parsed.data.spec.mergeRelationshipTypes).toEqual([]);
  });

  it('writes only fields the create API accepts', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = new OpenRoadieHttpClient(
      { backendUrl: 'http://localhost:7008' } as OpenRoadieConfig,
      (async (input: string | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (
          path === '/api/catalog-datastore/context-groups/rules' &&
          init?.method === 'POST'
        ) {
          bodies.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ id: 'g-1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof globalThis.fetch,
    );

    const bundle: ParsedBundle = {
      manifest: {
        name: 'shape',
        prerequisites: { integrations: [] },
      },
      errors: [],
      items: [
        {
          apiVersion: API_VERSION,
          kind: 'ContextGroup',
          metadata: { slug: 'ecr-github', name: 'ECR & GitHub' },
          spec: {
            datasources: [{ datasourceSlug: 'ecr-repositories' }],
            mergeRelationshipTypes: [],
            annotations: [],
            includeExternalRelations: true,
          },
        },
      ],
    };
    const target = {
      workflows: [],
      integrations: [],
      rules: [],
      contextGroups: [],
      capabilities: [],
      actions: [],
      directRelationships: [],
    };
    const plan = buildImportPlan(
      bundle,
      target,
      { only: [], exclude: [] },
      'fail',
    );
    const report = await applyImportPlan(client, bundle, plan, target);

    expect(report.created).toEqual(['context-groups/ecr-github']);
    expect(bodies).toHaveLength(1);
    const unknownFields = Object.keys(bodies[0]).filter(
      k => !ACCEPTED_WRITE_FIELDS.includes(k),
    );
    expect(unknownFields).toEqual([]);
    expect(bodies[0].datasources).toEqual([{ seedName: 'ecr-repositories' }]);
  });
});
