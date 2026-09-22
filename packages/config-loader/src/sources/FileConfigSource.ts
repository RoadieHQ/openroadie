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
 * packages/config-loader/src/sources/FileConfigSource.ts at v1.47.1, and modified.
 */

import chokidar from 'chokidar';
import fs from 'fs-extra';
import { isAbsolute, basename, dirname, resolve } from 'node:path';
import { NotFoundError } from '@roadiehq/errors';
import type { JsonObject } from '@roadiehq/types';
import { createConfigTransformer } from './transform/apply';
import { parseYamlContent } from './utils';
import type {
  AsyncConfigSourceGenerator,
  ConfigSource,
  ConfigSourceData,
  Parser,
  ReadConfigDataOptions,
  SubstitutionFunc,
} from './types';

/**
 * Options for creating a FileConfigSource.
 *
 * @public
 */
export interface FileConfigSourceOptions {
  /**
   * The absolute path to the configuration file.
   */
  path: string;
  /**
   * An optional substitution function for resolving environment variable references.
   */
  substitutionFunc?: SubstitutionFunc;
  /**
   * Whether to watch the file for changes. Defaults to true.
   */
  watch?: boolean;
  /**
   * An optional parser function for the file contents.
   */
  parser?: Parser;
}

/**
 * Reads a file with retry logic for empty content (race condition handling).
 */
async function readFile(path: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(path, 'utf8');

    // Handle race condition where file might be empty during write
    if (content === '') {
      await new Promise(resolve => setTimeout(resolve, 10));
      return await fs.readFile(path, 'utf8');
    }

    return content;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

type WatchEvent = 'change' | 'abort';

/**
 * A config source that loads configuration from a file.
 *
 * The source will watch the file for changes by default, as well as any
 * referenced files through include directives.
 *
 * @public
 */
export class FileConfigSource implements ConfigSource {
  #path: string;
  #substitutionFunc?: SubstitutionFunc;
  #watch: boolean;
  #parser: Parser;

  private constructor(options: FileConfigSourceOptions) {
    this.#path = options.path;
    this.#substitutionFunc = options.substitutionFunc;
    this.#watch = options.watch ?? true;
    this.#parser = options.parser ?? parseYamlContent;
  }

  /**
   * Creates a new config source that loads configuration from the given path.
   *
   * @remarks
   *
   * The source will watch the file for changes, as well as any referenced files.
   *
   * @param options - Options for the config source.
   * @returns A new config source that loads from the given path.
   */
  static create(options: FileConfigSourceOptions): FileConfigSource {
    if (!isAbsolute(options.path)) {
      throw new Error(`Config load path is not absolute: "${options.path}"`);
    }
    return new FileConfigSource(options);
  }

  // Work is duplicated across each read, in practice that should not
  // have any impact since there won't be multiple consumers. If that
  // changes it might be worth refactoring this to avoid duplicate work.
  async *readConfigData(
    options?: ReadConfigDataOptions,
  ): AsyncConfigSourceGenerator {
    const signal = options?.signal;
    const configFileName = basename(this.#path);
    let watchedPaths: string[] | null = null;
    let watcher: chokidar.FSWatcher | null = null;

    if (this.#watch) {
      watchedPaths = new Array<string>();
      watcher = chokidar.watch(this.#path, {
        usePolling: process.env.NODE_ENV === 'test',
      });
    }

    const dir = dirname(this.#path);

    const transformer = createConfigTransformer({
      substitutionFunc: this.#substitutionFunc,
      readFile: async (path: string) => {
        const fullPath = resolve(dir, path);

        if (watcher && watchedPaths) {
          watcher.add(fullPath);
          watchedPaths.push(fullPath);
        }

        const data = await readFile(fullPath);
        if (data === undefined) {
          throw new NotFoundError(
            `failed to include "${fullPath}", file does not exist`,
          );
        }

        return data;
      },
    });

    const readConfigFile = async (): Promise<ConfigSourceData[]> => {
      if (watcher && watchedPaths) {
        watcher.unwatch(watchedPaths);
        watchedPaths.length = 0;
        watcher.add(this.#path);
        watchedPaths.push(this.#path);
      }

      const contents = await readFile(this.#path);
      if (contents === undefined) {
        throw new NotFoundError(`Config file "${this.#path}" does not exist`);
      }

      const { result: parsed } = await this.#parser({ contents });

      if (parsed === undefined) {
        return [];
      }

      try {
        const data = (await transformer(parsed, { dir })) as JsonObject;
        return [{ data, context: configFileName, path: this.#path }];
      } catch (error: unknown) {
        throw new Error(
          `Failed to read config file at "${this.#path}", ${(error as Error).message}`,
        );
      }
    };

    const onAbort = () => {
      signal?.removeEventListener('abort', onAbort);
      if (watcher) watcher.close();
    };

    signal?.addEventListener('abort', onAbort);

    yield { configs: await readConfigFile() };

    if (watcher) {
      for (;;) {
        const event = await this.#waitForEvent(watcher, signal);

        if (event === 'abort') {
          return;
        }

        yield { configs: await readConfigFile() };
      }
    }
  }

  toString(): string {
    return `FileConfigSource{path="${this.#path}"}`;
  }

  #waitForEvent(
    watcher: chokidar.FSWatcher,
    signal?: AbortSignal,
  ): Promise<WatchEvent> {
    return new Promise(resolve => {
      function onChange() {
        resolve('change');
        onDone();
      }

      function onAbort() {
        resolve('abort');
        onDone();
      }

      function onDone() {
        watcher.removeListener('change', onChange);
        signal?.removeEventListener('abort', onAbort);
      }

      watcher.addListener('change', onChange);
      signal?.addEventListener('abort', onAbort);
    });
  }
}
