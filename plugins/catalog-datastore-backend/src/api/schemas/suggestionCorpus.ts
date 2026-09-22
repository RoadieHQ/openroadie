import { ObjectDao } from '../../database';
import { buildFieldProfiles, type FieldProfileSet } from './field-profiling';

export interface SuggestionCorpus {
  datasourceId: string;
  total: number;
  items: Awaited<ReturnType<ObjectDao['sampleForSuggestions']>>['items'];
  objects: unknown[];
  profiles: FieldProfileSet;
}

/**
 * Per-run memo of each datasource's suggestion sample and field profiles.
 *
 * A batch Generate over N datasources evaluates every datasource against
 * every other, and previously re-sampled and re-profiled each one per
 * pairing — O(N²) sampling round-trips of identical data. Sharing one cache
 * across the run makes it once per datasource.
 *
 * Deliberately request-scoped: a cache that outlived the request would serve
 * stale samples after ingestion runs.
 */
export class SuggestionCorpusCache {
  private readonly corpora = new Map<string, Promise<SuggestionCorpus>>();

  constructor(
    private readonly objectDao: ObjectDao,
    private readonly workspaceId?: string,
  ) {}

  get(datasourceId: string): Promise<SuggestionCorpus> {
    let corpus = this.corpora.get(datasourceId);
    if (!corpus) {
      corpus = this.load(datasourceId);
      this.corpora.set(datasourceId, corpus);
    }
    return corpus;
  }

  private async load(datasourceId: string): Promise<SuggestionCorpus> {
    const sample = await this.objectDao.sampleForSuggestions(
      datasourceId,
      undefined,
      this.workspaceId,
    );
    const objects = sample.items.map(item => item.object);
    return {
      datasourceId,
      total: sample.total,
      items: sample.items,
      objects,
      profiles: buildFieldProfiles(objects),
    };
  }
}
