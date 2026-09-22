/*
 * Copyright 2026 Larder Software Limited
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
 */

export {
  secretStoreServiceRef,
  bootstrapSecretsLoaderServiceRef,
  bootstrapSecretsSyncAuthorizerServiceRef,
  selectOssStoreFromConfig,
  SecretStoreReadOnlyError,
  SecretStoreNotProvisionedError,
  BootstrapSecretsSyncAuthorizationError,
  maskSecret,
  toStoredSecretRef,
  fromStoredSecretRef,
  isWorkspaceSecretRef,
} from './secretStore';
export type {
  BootstrapSecretsLoaderService,
  BootstrapSecretsSyncAuthorizerService,
  SecretResolver,
  SecretWriter,
  SecretStoreService,
  SecretStoreInfo,
  SecretStorageMode,
  ResolveOptions,
  SecretStoreScope,
} from './secretStore';

export { createEnvSecretStore } from './stores/envSecretStore';
export type { EnvSecretStoreOptions } from './stores/envSecretStore';
export {
  createDotenvSecretStore,
  parseDotenv,
  serializeDotenv,
} from './stores/dotenvSecretStore';
export type { DotenvSecretStoreOptions } from './stores/dotenvSecretStore';

export { substituteSecrets, extractSecretRefs } from './substituteSecrets';
