import type { Knex } from 'knex';
import type { LoggerService } from '@roadiehq/extensions-api';
import {
  OBJECT_PRESENTATION_INDEX_KEYS,
  type CatalogDatastoreApi,
} from '@roadiehq/catalog-datastore-common';

const { getReviewedPresentationSelectorsForWorkflow } =
  require('../../seeds/presentation') as {
    getReviewedPresentationSelectorsForWorkflow: (workflow: {
      name: string;
      slug?: string;
    }) =>
      | {
          presentation_title_selector: string;
          presentation_subtitle_selector: string;
        }
      | undefined;
  };

type PresentationIndexClient = Pick<
  CatalogDatastoreApi,
  'listIndexConfigurations' | 'createIndexConfiguration'
>;

function isConflictError(error: unknown): boolean {
  if (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    error.statusCode === 409
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /already exists|duplicate|unique|conflict/i.test(message);
}

export async function backfillPresentationIndexConfigurations(options: {
  knex: Knex;
  client: PresentationIndexClient;
  logger: LoggerService;
}): Promise<{ created: number; skipped: number; matched: number }> {
  const workflows = await options
    .knex('catalog_workflows')
    .where('workflow_type', 'data-ingestion')
    .select('id', 'name', 'slug');

  let created = 0;
  let skipped = 0;
  let matched = 0;

  for (const workflow of workflows as Array<{
    id: string;
    name: string;
    slug: string;
  }>) {
    const selectors = getReviewedPresentationSelectorsForWorkflow(workflow);
    if (!selectors) {
      continue;
    }

    matched += 1;
    const existing = new Set(
      (await options.client.listIndexConfigurations(workflow.id)).map(
        configuration => configuration.key,
      ),
    );

    const requiredIndexes = [
      {
        key: OBJECT_PRESENTATION_INDEX_KEYS.title,
        valueExpression: selectors.presentation_title_selector,
        purpose: 'title' as const,
      },
      {
        key: OBJECT_PRESENTATION_INDEX_KEYS.subtitle,
        valueExpression: selectors.presentation_subtitle_selector,
        purpose: 'subtitle' as const,
      },
    ];

    for (const indexConfiguration of requiredIndexes) {
      if (existing.has(indexConfiguration.key)) {
        skipped += 1;
        continue;
      }

      try {
        await options.client.createIndexConfiguration(workflow.id, {
          key: indexConfiguration.key,
          valueExpression: indexConfiguration.valueExpression,
          purpose: indexConfiguration.purpose,
        });
        created += 1;
        existing.add(indexConfiguration.key);
      } catch (error) {
        if (isConflictError(error)) {
          skipped += 1;
          existing.add(indexConfiguration.key);
          continue;
        }

        options.logger.warn(
          `[startup-seeds] failed to backfill ${indexConfiguration.key} for "${workflow.name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  return { created, skipped, matched };
}
