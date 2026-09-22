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
 * packages/config-loader/src/sources/MutableConfigSource.ts at v1.47.1, and modified.
 */

import type { DeferredPromise, JsonObject } from '@roadiehq/types';
import { createDeferred } from '@roadiehq/types';
import { waitOrAbort } from './utils';
import type {
  AsyncConfigSourceGenerator,
  ConfigSource,
  ReadConfigDataOptions,
} from './types';

/**
 * Options for creating a MutableConfigSource.
 *
 * @public
 */
export interface MutableConfigSourceOptions {
  /**
   * An optional context string for the configuration.
   */
  context?: string;
  /**
   * Optional initial data for the configuration.
   */
  data?: JsonObject;
}

/**
 * A config source that can be mutated after creation.
 *
 * This is useful for testing or for cases where you need to update
 * configuration dynamically at runtime.
 *
 * @public
 */
export class MutableConfigSource implements ConfigSource {
  #currentData: JsonObject | undefined;
  #deferred: DeferredPromise;
  #context: string;
  #abortController = new AbortController();

  private constructor(context: string, initialData?: JsonObject) {
    this.#currentData = initialData;
    this.#context = context;
    this.#deferred = createDeferred();
  }

  /**
   * Creates a new mutable config source.
   *
   * @param options - Options for the config source.
   * @returns A new mutable config source.
   */
  static create(options?: MutableConfigSourceOptions): MutableConfigSource {
    return new MutableConfigSource(
      options?.context ?? 'mutable-config',
      options?.data,
    );
  }

  async *readConfigData(
    options?: ReadConfigDataOptions,
  ): AsyncConfigSourceGenerator {
    let deferredPromise = this.#deferred;

    if (this.#currentData !== undefined) {
      yield { configs: [{ data: this.#currentData, context: this.#context }] };
    }

    for (;;) {
      const [ok] = await waitOrAbort(deferredPromise, [
        options?.signal,
        this.#abortController.signal,
      ]);

      if (!ok) {
        return;
      }

      deferredPromise = this.#deferred;

      if (this.#currentData !== undefined) {
        yield {
          configs: [{ data: this.#currentData, context: this.#context }],
        };
      }
    }
  }

  /**
   * Set the data of the config source.
   *
   * @param data - The new data to set
   */
  setData(data: JsonObject): void {
    if (!this.#abortController.signal.aborted) {
      this.#currentData = data;
      const oldDeferred = this.#deferred;
      this.#deferred = createDeferred();
      oldDeferred.resolve();
    }
  }

  /**
   * Close the config source, preventing any further updates.
   */
  close(): void {
    this.#currentData = undefined;
    this.#abortController.abort();
  }

  toString(): string {
    return `MutableConfigSource{}`;
  }
}
