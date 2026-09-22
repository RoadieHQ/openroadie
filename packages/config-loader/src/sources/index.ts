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
 * packages/config-loader/src/sources/index.ts at v1.47.1, and modified.
 */

export { EnvConfigSource, readEnvConfig } from './EnvConfigSource';
export type { EnvConfigSourceOptions } from './EnvConfigSource';

export { FileConfigSource } from './FileConfigSource';
export type { FileConfigSourceOptions } from './FileConfigSource';

export { MergedConfigSource } from './MergedConfigSource';

export { MutableConfigSource } from './MutableConfigSource';
export type { MutableConfigSourceOptions } from './MutableConfigSource';

export { ObservableConfigProxy } from './ObservableConfigProxy';

export { RemoteConfigSource } from './RemoteConfigSource';
export type { RemoteConfigSourceOptions } from './RemoteConfigSource';

export { StaticConfigSource } from './StaticConfigSource';
export type { StaticConfigSourceOptions } from './StaticConfigSource';

export { ConfigSources } from './ConfigSources';
export type {
  ConfigTarget,
  ConfigTarget as ConfigSourceTarget,
  ConfigSourcesDefaultForTargetsOptions,
  ConfigSourcesDefaultForTargetsOptions as BaseConfigSourcesOptions,
  ConfigSourcesDefaultOptions,
  ClosableConfig,
} from './ConfigSources';

export type {
  AsyncConfigSourceGenerator,
  ConfigSource,
  ConfigSourceData,
  EnvFunc,
  Parser,
  ReadConfigDataOptions,
  SubstitutionFunc,
} from './types';

export { parseYamlContent, waitOrAbort } from './utils';
