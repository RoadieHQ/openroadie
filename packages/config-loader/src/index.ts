// Legacy loader (deprecated)
export { loadConfig } from './loader';
export type {
  ConfigTarget,
  LoadConfigOptions,
  LoadConfigOptionsRemote,
  LoadConfigOptionsWatch,
  LoadConfigResult,
} from './loader';

export {
  ConfigSources,
  EnvConfigSource,
  FileConfigSource,
  MutableConfigSource,
  RemoteConfigSource,
  StaticConfigSource,
  readEnvConfig,
} from './sources';

export type {
  ConfigSource,
  ConfigSourceData,
  ReadConfigDataOptions,
  AsyncConfigSourceGenerator,
  SubstitutionFunc,
  Parser,
  EnvConfigSourceOptions,
  FileConfigSourceOptions,
  MutableConfigSourceOptions,
  RemoteConfigSourceOptions,
  StaticConfigSourceOptions,
  ConfigSourceTarget,
  ClosableConfig,
  BaseConfigSourcesOptions,
  ConfigSourcesDefaultOptions,
  ConfigSourcesDefaultForTargetsOptions,
} from './sources';

// Re-export SubstitutionFunc as EnvFunc for backwards compatibility
export type { SubstitutionFunc as EnvFunc } from './sources';
