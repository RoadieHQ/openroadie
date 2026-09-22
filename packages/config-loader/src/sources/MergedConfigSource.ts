/*
 * Copyright 2023 The Backstage Authors
 * Modifications copyright 2026 Larder Software Limited
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
 *
 * Derived from Backstage (https://github.com/backstage/backstage),
 * packages/config-loader/src/sources/MergedConfigSource.ts at v1.47.1, and modified.
 */

import type {
  AsyncConfigSourceGenerator,
  ConfigSource,
  ConfigSourceData,
  ReadConfigDataOptions,
} from './types';

const sourcesSymbol = Symbol.for(
  '@roadiehq/config-loader#MergedConfigSource.sources',
);

interface IndexedError extends Error {
  index: number;
}

function hasMergedSources(
  source: ConfigSource,
): source is ConfigSource & { [sourcesSymbol]: ConfigSource[] } {
  return (
    sourcesSymbol in source &&
    Array.isArray((source as { [sourcesSymbol]?: unknown })[sourcesSymbol])
  );
}

/**
 * Wraps the next() call to include the iterator index.
 */
function nextWithIndex(
  iterator: AsyncConfigSourceGenerator,
  index: number,
): Promise<[number, IteratorResult<{ configs: ConfigSourceData[] }, void>]> {
  return iterator.next().then(
    r => [index, r],
    e => {
      throw Object.assign(e, { index });
    },
  );
}

/**
 * A config source that merges multiple config sources into a single source.
 *
 * The merged source reads from all sources in parallel and concatenates
 * their results. When any source updates, the merged source yields a new
 * result with all current values.
 *
 * @public
 */
export class MergedConfigSource implements ConfigSource {
  readonly #sources: ConfigSource[];
  readonly [sourcesSymbol]: ConfigSource[];

  private constructor(sources: ConfigSource[]) {
    this.#sources = sources;
    this[sourcesSymbol] = this.#sources;
  }

  /**
   * An optimization to flatten nested merged sources to avoid unnecessary microtasks.
   */
  static #flattenSources(sources: ConfigSource[]): ConfigSource[] {
    return sources.flatMap(source => {
      if (hasMergedSources(source)) {
        return this.#flattenSources(source[sourcesSymbol]);
      }
      return source;
    });
  }

  /**
   * Creates a merged config source from the given sources.
   *
   * @param sources - The sources to merge
   * @returns A new merged config source
   */
  static from(sources: ConfigSource[]): MergedConfigSource {
    return new MergedConfigSource(this.#flattenSources(sources));
  }

  async *readConfigData(
    options?: ReadConfigDataOptions,
  ): AsyncConfigSourceGenerator {
    const its = this.#sources.map(source => source.readConfigData(options));

    const initialResults = await Promise.all(its.map(it => it.next()));
    const configs: ConfigSourceData[][] = initialResults.map((result, i) => {
      if (result.done) {
        throw new Error(
          `Config source ${String(this.#sources[i])} returned no data`,
        );
      }
      return result.value.configs;
    });

    yield { configs: configs.flat(1) };

    const results: (
      | Promise<[number, IteratorResult<{ configs: ConfigSourceData[] }, void>]>
      | undefined
    )[] = its.map((it, i) => nextWithIndex(it, i));

    while (results.some(Boolean)) {
      try {
        const [i, result] = await Promise.race(
          results.filter(
            (
              r,
            ): r is Promise<
              [number, IteratorResult<{ configs: ConfigSourceData[] }, void>]
            > => Boolean(r),
          ),
        );

        if (result.done) {
          results[i] = undefined;
        } else {
          results[i] = nextWithIndex(its[i], i);
          configs[i] = result.value.configs;
          yield { configs: configs.flat(1) };
        }
      } catch (error: unknown) {
        const indexedError = error as IndexedError;
        const source = this.#sources[indexedError.index];
        if (source) {
          throw new Error(`Config source ${String(source)} failed: ${error}`);
        }
        throw error;
      }
    }
  }

  toString(): string {
    return `MergedConfigSource{${this.#sources.map(String).join(', ')}}`;
  }
}
