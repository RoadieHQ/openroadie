/*
 * Copyright 2022 Larder Software Ltd.
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

import { Secret } from './types';

export type SecretMetadata = {
  name: string;
  description?: string;
  helpUrl?: string;
};

export interface SecretsSettingsApi {
  getKeys(): Promise<Secret[]>;
  getMetadata(): Promise<SecretMetadata[]>;
  getSecret(secret: string): Promise<Secret>;
  deleteSecret(secret: string): Promise<void>;
  deleteSecretMetadata(name: string): Promise<void>;
  setSecret(name: string, value: string): Promise<void>;
  addSecret(secret: {
    name: string;
    description?: string;
    helpUrl?: string;
    internalKeyName?: string;
  }): Promise<void>;
  editSecret(
    name: string,
    patch: {
      description?: string | null;
      helpUrl?: string | null;
      name?: string;
      internalKeyName?: string;
    },
  ): Promise<void>;
  getStorageMode(): Promise<{
    mode: 'env' | 'dotenv' | 'scoped';
    readOnly: boolean;
    dotenvPath?: string;
  }>;
  getSecretStatus(ref: string): Promise<{ exists: boolean }>;
}
