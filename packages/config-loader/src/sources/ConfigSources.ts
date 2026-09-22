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
 * packages/config-loader/src/sources/ConfigSources.ts at v1.47.1, and modified.
 */

import { resolve } from 'node:path';
import fs from 'fs-extra';
import { ConfigReader } from '@roadiehq/config';
import type { Config } from '@roadiehq/config';
import type { HumanDuration } from '@roadiehq/types';
import parseArgs from 'minimist';
import { findPaths } from '../find-paths';
import { EnvConfigSource } from './EnvConfigSource';
import { FileConfigSource } from './FileConfigSource';
import { MergedConfigSource } from './MergedConfigSource';
import { RemoteConfigSource } from './RemoteConfigSource';
import { ObservableConfigProxy } from './ObservableConfigProxy';
import type { ConfigSource, SubstitutionFunc } from './types';

/**
 * A configuration target parsed from command line arguments.
 *
 * @public
 */
export interface ConfigTarget {
  /**
   * The type of the target.
   */
  type: 'path' | 'url';
  /**
   * The target path or URL.
   */
  target: string;
}

/**
 * Options for creating default config sources for specific targets.
 *
 * @public
 */
export interface ConfigSourcesDefaultForTargetsOptions {
  /**
   * The targets to create sources for.
   */
  targets: ConfigTarget[];
  /**
   * The root directory for resolving relative paths.
   */
  rootDir?: string;
  /**
   * Whether to watch files for changes.
   */
  watch?: boolean;
  /**
   * A substitution function for resolving environment variable references.
   */
  substitutionFunc?: SubstitutionFunc;
  /**
   * Options for remote configuration sources.
   */
  remote?: {
    reloadInterval?: HumanDuration;
  };
  /**
   * Whether to allow missing default config files.
   */
  allowMissingDefaultConfig?: boolean;
}

/**
 * Options for creating the default config source.
 *
 * @public
 */
export interface ConfigSourcesDefaultOptions extends Omit<
  ConfigSourcesDefaultForTargetsOptions,
  'targets'
> {
  /**
   * Command line arguments to parse for config targets.
   */
  argv?: string[];
  /**
   * Environment variables to read from.
   */
  env?: Record<string, string | undefined>;
}

/**
 * A closable configuration that can be closed to stop watching for changes.
 *
 * @public
 */
export interface ClosableConfig extends Config {
  /**
   * Closes the config, stopping any watchers.
   */
  close(): void;
}

/**
 * Utility class for creating and managing configuration sources.
 *
 * @public
 */
export class ConfigSources {
  /**
   * Parses command line arguments and returns the config targets.
   *
   * @param argv - The command line arguments to parse. Defaults to `process.argv`
   * @returns A list of config targets
   */
  static parseArgs(argv: string[] = process.argv): ConfigTarget[] {
    const args = [parseArgs(argv).config].flat().filter(Boolean) as string[];

    return args.map(target => {
      try {
        const url = new URL(target);
        if (!url.host) {
          return { type: 'path' as const, target };
        }
        return { type: 'url' as const, target };
      } catch {
        return { type: 'path' as const, target };
      }
    });
  }

  /**
   * Creates the default config sources for the provided targets.
   *
   * @remarks
   *
   * This will create {@link FileConfigSource}s and {@link RemoteConfigSource}s
   * for the provided targets, and merge them together to a single source.
   * If no targets are provided it will fall back to `app-config.yaml` and
   * `app-config.local.yaml`.
   *
   * URL targets are only supported if the `remote` option is provided.
   *
   * @param options - Options
   * @returns A config source for the provided targets
   */
  static defaultForTargets(
    options: ConfigSourcesDefaultForTargetsOptions,
  ): ConfigSource {
    const rootDir = options.rootDir ?? findPaths(process.cwd()).targetRoot;

    const argSources: ConfigSource[] = options.targets.map(arg => {
      if (arg.type === 'url') {
        if (!options.remote) {
          throw new Error(
            `Config argument "${arg.target}" looks like a URL but remote configuration is not enabled. Enable it by passing the \`remote\` option`,
          );
        }

        return RemoteConfigSource.create({
          url: arg.target,
          substitutionFunc: options.substitutionFunc,
          reloadInterval: options.remote.reloadInterval,
        });
      }

      return FileConfigSource.create({
        watch: options.watch,
        path: resolve(arg.target),
        substitutionFunc: options.substitutionFunc,
      });
    });

    if (argSources.length === 0) {
      const defaultPath = resolve(rootDir, 'app-config.yaml');
      const localPath = resolve(rootDir, 'app-config.local.yaml');
      const envPath = resolve(
        rootDir,
        `app-config.${process.env.ROADIE_ENV}.yaml`,
      );
      const envLocalPath = resolve(
        rootDir,
        `app-config.${process.env.ROADIE_ENV}.local.yaml`,
      );

      const alwaysIncludeDefaultConfigSource =
        !options.allowMissingDefaultConfig;

      if (alwaysIncludeDefaultConfigSource || fs.pathExistsSync(defaultPath)) {
        argSources.push(
          FileConfigSource.create({
            watch: options.watch,
            path: defaultPath,
            substitutionFunc: options.substitutionFunc,
          }),
        );
      }

      if (process.env.ROADIE_ENV && fs.pathExistsSync(envPath)) {
        argSources.push(
          FileConfigSource.create({
            watch: options.watch,
            path: envPath,
            substitutionFunc: options.substitutionFunc,
          }),
        );
      }

      if (fs.pathExistsSync(localPath)) {
        argSources.push(
          FileConfigSource.create({
            watch: options.watch,
            path: localPath,
            substitutionFunc: options.substitutionFunc,
          }),
        );
      }

      if (process.env.ROADIE_ENV && fs.pathExistsSync(envLocalPath)) {
        argSources.push(
          FileConfigSource.create({
            watch: options.watch,
            path: envLocalPath,
            substitutionFunc: options.substitutionFunc,
          }),
        );
      }
    }

    return this.merge(argSources);
  }

  /**
   * Creates the default config source for Roadie.
   *
   * @remarks
   *
   * This will read from `app-config.yaml` and `app-config.local.yaml` by
   * default, as well as environment variables prefixed with `APP_CONFIG_`.
   * If `--config <path|url>` command line arguments are passed, these will
   * override the default configuration file paths. URLs are only supported
   * if the `remote` option is provided.
   *
   * @param options - Options
   * @returns The default Roadie config source
   */
  static default(options: ConfigSourcesDefaultOptions): ConfigSource {
    const argSource = this.defaultForTargets({
      ...options,
      targets: this.parseArgs(options.argv),
    });

    const envSource = EnvConfigSource.create({
      env: options.env,
    });

    return this.merge([argSource, envSource]);
  }

  /**
   * Merges multiple config sources into a single source that reads from all
   * sources and concatenates the result.
   *
   * @param sources - The config sources to merge
   * @returns A single config source that concatenates the data from the given sources
   */
  static merge(sources: ConfigSource[]): ConfigSource {
    return MergedConfigSource.from(sources);
  }

  /**
   * Creates an observable {@link @roadiehq/config#Config} implementation from a {@link ConfigSource}.
   *
   * @remarks
   *
   * If you only want to read the config once you can close the returned config immediately.
   *
   * @example
   *
   * ```ts
   * const sources = ConfigSources.default(...)
   * const config = await ConfigSources.toConfig(source)
   * config.close()
   * const example = config.getString(...)
   * ```
   *
   * @param source - The config source to read from
   * @returns A promise that resolves to a closable config
   */
  static toConfig(source: ConfigSource): Promise<ClosableConfig> {
    return new Promise((resolve, reject) => {
      let config: ObservableConfigProxy | undefined = undefined;

      void (async () => {
        try {
          const abortController = new AbortController();

          for await (const { configs } of source.readConfigData({
            signal: abortController.signal,
          })) {
            if (config) {
              config.setConfig(ConfigReader.fromConfigs(configs));
            } else {
              config = ObservableConfigProxy.create(abortController);
              config.setConfig(ConfigReader.fromConfigs(configs));
              resolve(config);
            }
          }
        } catch (error: unknown) {
          reject(error);
        }
      })();
    });
  }
}
