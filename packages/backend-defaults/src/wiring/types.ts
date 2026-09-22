/*
 * Copyright 2024 Larder Software Ltd.
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

import type {
  BackendFeature,
  ExtensionPoint,
  ServiceRef,
} from '@roadiehq/extensions-api';

export interface ModuleResult {
  moduleId: string;
  resultAt: Date;
  failure?: {
    error: Error;
    allowed: boolean;
  };
}

export interface PluginResult {
  pluginId: string;
  resultAt: Date;
  modules: ModuleResult[];
  failure?: {
    error: Error;
    allowed: boolean;
  };
}

export interface StartupResult {
  beginAt: Date;
  resultAt: Date;
  outcome: 'success' | 'failure';
  plugins: PluginResult[];
}

export interface BackendInstance {
  add(
    feature:
      | BackendFeature
      | Promise<{ default: BackendFeature }>
      | (() => BackendFeature),
  ): void;
  start(): Promise<{ result: StartupResult }>;
  stop(): Promise<void>;
}

export interface InternalBackendFeature extends BackendFeature {
  version: 'v1';
  featureType: 'service' | 'registrations' | 'loader';
}

export interface InternalServiceFactory extends InternalBackendFeature {
  featureType: 'service';
  service: ServiceRef<unknown>;
  deps: Record<string, ServiceRef<unknown>>;
  factory: (
    deps: Record<string, unknown>,
    context: unknown,
  ) => Promise<unknown>;
  createRootContext?: (deps: Record<string, unknown>) => Promise<unknown>;
  initialization?: 'lazy' | 'always';
}

export interface PluginRegistration {
  type: 'plugin' | 'plugin-v1.1';
  pluginId: string;
  extensionPoints: Array<[ExtensionPoint<unknown>, unknown]>;
  init: {
    deps: Record<string, ServiceRef<unknown> | ExtensionPoint<unknown>>;
    func: (deps: Record<string, unknown>) => Promise<void>;
  };
}

export interface ModuleRegistration {
  type: 'module' | 'module-v1.1';
  pluginId: string;
  moduleId: string;
  extensionPoints: Array<{
    extensionPoint: ExtensionPoint<unknown>;
    factory: (options: {
      reportModuleStartupFailure: (options: { error: Error }) => void;
    }) => unknown;
  }>;
  init: {
    deps: Record<string, ServiceRef<unknown> | ExtensionPoint<unknown>>;
    func: (deps: Record<string, unknown>) => Promise<void>;
  };
}

export type BackendRegistration = PluginRegistration | ModuleRegistration;

export interface BackendRegistrations extends InternalBackendFeature {
  featureType: 'registrations';
  getRegistrations(): BackendRegistration[];
}

export interface BackendFeatureLoader extends InternalBackendFeature {
  featureType: 'loader';
  description: string;
  deps?: Record<string, ServiceRef<unknown>>;
  loader: (deps: Record<string, unknown>) => Promise<BackendFeature[]>;
}

export interface InstalledPlugin {
  pluginId: string;
  modules: Array<{ moduleId: string }>;
}

export interface RootInstanceMetadata {
  getInstalledPlugins(): Promise<readonly InstalledPlugin[]>;
}

export interface LifecycleServiceWithHooks {
  startup(): Promise<void>;
  shutdown(): Promise<void>;
  beforeShutdown?(): Promise<void>;
}

export type AllowBootFailurePredicate = (
  pluginId: string,
  moduleId?: string,
) => boolean;

export interface InitializationResultCollector {
  onPluginResult(pluginId: string, error?: Error): void;
  onPluginModuleResult(pluginId: string, moduleId: string, error?: Error): void;
  amendPluginModuleResult(
    pluginId: string,
    moduleId: string,
    error: Error,
  ): void;
  finalize(): StartupResult;
}
