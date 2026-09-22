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
 * packages/config-loader/src/sources/RemoteConfigSource.ts at v1.47.1, and modified.
 */

import { ResponseError } from '@roadiehq/errors';
import { durationToMilliseconds } from '@roadiehq/types';
import type { HumanDuration, JsonObject } from '@roadiehq/types';
import isEqual from 'lodash/isEqual';
import { createConfigTransformer } from './transform/apply';
import { parseYamlContent } from './utils';
import type {
  AsyncConfigSourceGenerator,
  ConfigSource,
  Parser,
  ReadConfigDataOptions,
  SubstitutionFunc,
} from './types';

const DEFAULT_RELOAD_INTERVAL: HumanDuration = { seconds: 60 };

/**
 * Options for creating a RemoteConfigSource.
 *
 * @public
 */
export interface RemoteConfigSourceOptions {
  /**
   * The URL to fetch configuration from.
   */
  url: string;
  /**
   * An optional substitution function for resolving environment variable references.
   */
  substitutionFunc?: SubstitutionFunc;
  /**
   * The interval at which to reload the configuration. Defaults to 60 seconds.
   */
  reloadInterval?: HumanDuration;
  /**
   * An optional parser function for the response contents.
   */
  parser?: Parser;
}

/**
 * A config source that loads configuration from a remote URL.
 *
 * The source will periodically reload the configuration at the specified interval.
 *
 * @public
 */
export class RemoteConfigSource implements ConfigSource {
  #url: string;
  #reloadIntervalMs: number;
  #transformer: (
    input: unknown,
    ctx?: { dir?: string },
  ) => Promise<Record<string, unknown>>;
  #parser: Parser;

  private constructor(options: RemoteConfigSourceOptions) {
    this.#url = options.url;
    this.#reloadIntervalMs = durationToMilliseconds(
      options.reloadInterval ?? DEFAULT_RELOAD_INTERVAL,
    );
    this.#transformer = createConfigTransformer({
      substitutionFunc: options.substitutionFunc,
    });
    this.#parser = options.parser ?? parseYamlContent;
  }

  /**
   * Creates a new {@link RemoteConfigSource}.
   *
   * @param options - Options for the source.
   * @returns A new remote config source.
   */
  static create(options: RemoteConfigSourceOptions): RemoteConfigSource {
    try {
      new URL(options.url);
    } catch (error: unknown) {
      throw new Error(
        `Invalid URL provided to remote config source, '${options.url}', ${error}`,
      );
    }
    return new RemoteConfigSource(options);
  }

  async *readConfigData(
    options?: ReadConfigDataOptions,
  ): AsyncConfigSourceGenerator {
    let data = await this.#load();

    yield { configs: [{ data, context: this.#url }] };

    for (;;) {
      await this.#wait(options?.signal);

      if (options?.signal?.aborted) {
        return;
      }

      try {
        const newData = await this.#load(options?.signal);

        if (newData && !isEqual(data, newData)) {
          data = newData;
          yield { configs: [{ data, context: this.#url }] };
        }
      } catch (error: unknown) {
        if ((error as Error).name !== 'AbortError') {
          console.error(`Failed to read config from ${this.#url}, ${error}`);
        }
      }
    }
  }

  toString(): string {
    return `RemoteConfigSource{path="${this.#url}"}`;
  }

  async #load(signal?: AbortSignal): Promise<JsonObject> {
    const res = await fetch(this.#url, {
      signal,
    });

    if (!res.ok) {
      throw await ResponseError.fromResponse(res);
    }

    const contents = await res.text();
    const { result: rawData } = await this.#parser({ contents });

    if (rawData === undefined) {
      throw new Error('configuration data is null');
    }

    const data = await this.#transformer(rawData);

    if (typeof data !== 'object') {
      throw new Error('configuration data is not an object');
    } else if (Array.isArray(data)) {
      throw new Error(
        'configuration data is an array, expected an object instead',
      );
    }

    return data as JsonObject;
  }

  async #wait(signal?: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const timeoutId = setTimeout(onDone, this.#reloadIntervalMs);

      signal?.addEventListener('abort', onDone);

      function onDone() {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onDone);
        resolve();
      }
    });
  }
}
