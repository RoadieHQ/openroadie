import type { JsonObject, HumanDuration, Observable } from '@roadiehq/types';
import type { AppConfig, Config } from '@roadiehq/config';
import type {
  SubstitutionFunc,
  Parser,
  ConfigSource,
  ConfigSourceData,
  ReadConfigDataOptions,
  AsyncConfigSourceGenerator,
} from './sources/types';

/**
 * @public
 * @deprecated Use {@link ConfigSources.default} instead.
 */
export type ConfigTarget =
  | {
      path: string;
    }
  | {
      url: string;
    };

/**
 * @public
 * @deprecated Use {@link ConfigSources.default} instead.
 */
export type LoadConfigOptionsWatch = {
  /**
   * A listener that is called when a config file is changed.
   */
  onChange: (configs: AppConfig[]) => void;
  /**
   * An optional signal that stops the watcher once the promise resolves.
   */
  stopSignal?: Promise<void>;
};

/**
 * @public
 * @deprecated Use {@link ConfigSources.default} instead.
 */
export type LoadConfigOptionsRemote = {
  /**
   * A remote config reloading period, in seconds
   */
  reloadIntervalSeconds: number;
};

/**
 * Options that control the loading of configuration files in the backend.
 *
 * @public
 * @deprecated Use {@link ConfigSources.default} instead.
 */
export type LoadConfigOptions = {
  configRoot: string;
  configTargets: ConfigTarget[];
  /**
   * Custom environment variable loading function
   *
   * @experimental This API is not stable and may change at any point
   */
  experimentalEnvFunc?: (name: string) => Promise<string | undefined>;
  /**
   * An optional remote config
   */
  remote?: LoadConfigOptionsRemote;
  /**
   * An optional configuration that enables watching of config files.
   */
  watch?: LoadConfigOptionsWatch;
};

/**
 * Results of loading configuration files.
 * @public
 * @deprecated Use {@link ConfigSources.default} instead.
 */
export type LoadConfigResult = {
  /**
   * Array of all loaded configs.
   */
  appConfigs: AppConfig[];
};

/**
 * A target to read configuration from.
 *
 * @public
 */
export type ConfigSourceTarget =
  | {
      type: 'path';
      target: string;
    }
  | {
      type: 'url';
      target: string;
    };

/**
 * A config implementation that can be closed.
 *
 * @remarks
 *
 * Closing the configuration instance will stop the reading from the underlying source.
 *
 * @public
 */
export interface ClosableConfig extends Config {
  /**
   * Closes the configuration instance.
   *
   * @remarks
   *
   * The configuration instance will still be usable after closing, but it will
   * no longer be updated with new values from the underlying source.
   */
  close(): void;
}

/**
 * Options for {@link RemoteConfigSource.create}.
 *
 * @public
 */
export interface RemoteConfigSourceOptions {
  /**
   * The URL to load the config from.
   */
  url: string;
  /**
   * How often to reload the config from the remote URL, defaults to 1 minute.
   *
   * Set to Infinity to disable reloading, for example `{ days: Infinity }`.
   */
  reloadInterval?: HumanDuration;
  /**
   * A substitution function to use instead of the default environment substitution.
   */
  substitutionFunc?: SubstitutionFunc;
  /**
   * A content parsing function to transform string content to configuration values.
   */
  parser?: Parser;
}

/**
 * Options for {@link EnvConfigSource.create}.
 *
 * @public
 */
export interface EnvConfigSourceOptions {
  /**
   * The environment variables to use, defaults to `process.env`.
   */
  env?: Record<string, string | undefined>;
}

/**
 * Options for {@link FileConfigSource.create}.
 *
 * @public
 */
export interface FileConfigSourceOptions {
  /**
   * The path to the config file that should be loaded.
   */
  path: string;
  /**
   * Set to `false` to disable file watching, defaults to `true`.
   */
  watch?: boolean;
  /**
   * A substitution function to use instead of the default environment substitution.
   */
  substitutionFunc?: SubstitutionFunc;
  /**
   * A content parsing function to transform string content to configuration values.
   */
  parser?: Parser;
}

/**
 * Options for {@link MutableConfigSource.create}.
 *
 * @public
 */
export interface MutableConfigSourceOptions {
  data?: JsonObject;
  context?: string;
}

/**
 * Options for {@link StaticConfigSource.create}.
 *
 * @public
 */
export interface StaticConfigSourceOptions {
  data:
    | JsonObject
    | Observable<JsonObject>
    | PromiseLike<JsonObject>
    | AsyncIterable<JsonObject>;
  context?: string;
}

/**
 * Common options for the default configuration sources.
 *
 * @public
 */
export interface BaseConfigSourcesOptions {
  watch?: boolean;
  rootDir?: string;
  remote?: Pick<RemoteConfigSourceOptions, 'reloadInterval'>;
  /**
   * Allow the default app-config.yaml to be missing, in which case the source
   * will not be created.
   */
  allowMissingDefaultConfig?: boolean;
  /**
   * A custom substitution function that overrides the default one.
   *
   * @remarks
   * The substitution function handles syntax like `${MY_ENV_VAR}` in configuration values.
   * The default substitution will read the value from the environment and trim whitespace.
   */
  substitutionFunc?: SubstitutionFunc;
}

/**
 * Options for {@link ConfigSources.defaultForTargets}.
 *
 * @public
 */
export interface ConfigSourcesDefaultForTargetsOptions extends BaseConfigSourcesOptions {
  targets: ConfigSourceTarget[];
}

/**
 * Options for {@link ConfigSources.default}.
 *
 * @public
 */
export interface ConfigSourcesDefaultOptions extends BaseConfigSourcesOptions {
  argv?: string[];
  env?: Record<string, string | undefined>;
}

// Re-export source types that are used in the main types
export type {
  SubstitutionFunc,
  Parser,
  ConfigSource,
  ConfigSourceData,
  ReadConfigDataOptions,
  AsyncConfigSourceGenerator,
};
