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
 * packages/config-loader/src/sources/StaticConfigSource.ts at v1.47.1, and modified.
 */

import type { DeferredPromise, JsonObject, Observable } from '@roadiehq/types';
import { createDeferred } from '@roadiehq/types';
import type {
  AsyncConfigSourceGenerator,
  ConfigSource,
  ReadConfigDataOptions,
} from './types';

/**
 * Options for creating a StaticConfigSource.
 *
 * @public
 */
export interface StaticConfigSourceOptions {
  /**
   * The configuration data. Can be a plain object, a promise, an observable, or an async iterable.
   */
  data:
    | JsonObject
    | Promise<JsonObject>
    | Observable<JsonObject>
    | AsyncIterable<JsonObject>;
  /**
   * An optional context string for the configuration.
   */
  context?: string;
}

/**
 * Checks if a value is an Observable.
 */
function isObservable(value: unknown): value is Observable<JsonObject> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'subscribe' in value &&
    typeof (value as { subscribe: unknown }).subscribe === 'function'
  );
}

/**
 * Checks if a value is an AsyncIterable.
 */
function isAsyncIterable(value: unknown): value is AsyncIterable<JsonObject> {
  return (
    typeof value === 'object' && value !== null && Symbol.asyncIterator in value
  );
}

/**
 * A config source that wraps a static observable data source.
 */
class StaticObservableConfigSource implements ConfigSource {
  #data: Observable<JsonObject>;
  #context: string;

  constructor(data: Observable<JsonObject>, context: string) {
    this.#data = data;
    this.#context = context;
  }

  async *readConfigData(
    options?: ReadConfigDataOptions,
  ): AsyncConfigSourceGenerator {
    const queue = new Array<JsonObject>();
    let deferred: DeferredPromise = createDeferred();

    const sub = this.#data.subscribe({
      next(value: JsonObject) {
        queue.push(value);
        deferred.resolve();
        deferred = createDeferred();
      },
      complete() {
        deferred.resolve();
      },
    });

    const signal = options?.signal;
    if (signal) {
      const onAbort = () => {
        sub.unsubscribe();
        queue.length = 0;
        deferred.resolve();
        signal.removeEventListener('abort', onAbort);
      };
      signal.addEventListener('abort', onAbort);
    }

    for (;;) {
      await deferred;

      if (queue.length === 0) {
        return;
      }

      while (queue.length > 0) {
        yield { configs: [{ data: queue.shift()!, context: this.#context }] };
      }
    }
  }
}

/**
 * A config source that provides static configuration data.
 *
 * The data can be provided as a plain object, a promise, an observable, or an async iterable.
 *
 * @public
 */
export class StaticConfigSource implements ConfigSource {
  #promise: Promise<JsonObject>;
  #context: string;

  private constructor(promise: Promise<JsonObject>, context: string) {
    this.#promise = promise;
    this.#context = context;
  }

  /**
   * Creates a new {@link StaticConfigSource}.
   *
   * @param options - Options for the config source
   * @returns A new static config source
   */
  static create(options: StaticConfigSourceOptions): ConfigSource {
    const { data, context = 'static-config' } = options;

    if (!data) {
      return {
        async *readConfigData(): AsyncConfigSourceGenerator {
          yield { configs: [] };
          return;
        },
      };
    }

    if (isObservable(data)) {
      return new StaticObservableConfigSource(data, context);
    }

    if (isAsyncIterable(data)) {
      return {
        async *readConfigData(): AsyncConfigSourceGenerator {
          for await (const value of data) {
            yield { configs: [{ data: value, context }] };
          }
        },
      };
    }

    return new StaticConfigSource(
      data instanceof Promise ? data : Promise.resolve(data),
      context,
    );
  }

  async *readConfigData(
    _options?: ReadConfigDataOptions,
  ): AsyncConfigSourceGenerator {
    yield { configs: [{ data: await this.#promise, context: this.#context }] };
    return;
  }

  toString(): string {
    return `StaticConfigSource{}`;
  }
}
