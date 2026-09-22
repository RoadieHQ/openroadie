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
 * packages/config-loader/src/sources/ObservableConfigProxy.ts at v1.47.1, and modified.
 */

import { ConfigReader } from '@roadiehq/config';
import type { Config } from '@roadiehq/config';
import isEqual from 'lodash/isEqual';

/**
 * A proxy that wraps a ConfigReader and provides observable capabilities.
 *
 * Changes to the underlying config will notify all subscribers.
 *
 * @public
 */
export class ObservableConfigProxy implements Config {
  #config: ConfigReader = new ConfigReader({});
  #subscribers: Array<() => void> = [];
  #parent?: ObservableConfigProxy;
  #parentKey?: string;
  #abortController?: AbortController;

  private constructor(
    parent?: ObservableConfigProxy,
    parentKey?: string,
    abortController?: AbortController,
  ) {
    this.#parent = parent;
    this.#parentKey = parentKey;
    this.#abortController = abortController;

    if (parent && !parentKey) {
      throw new Error('parentKey is required if parent is set');
    }
  }

  /**
   * Creates a new ObservableConfigProxy.
   *
   * @param abortController - An abort controller to close the config
   * @returns A new ObservableConfigProxy
   */
  static create(abortController: AbortController): ObservableConfigProxy {
    return new ObservableConfigProxy(undefined, undefined, abortController);
  }

  /**
   * Sets the underlying config and notifies subscribers if changed.
   *
   * @param config - The new config to set
   */
  setConfig(config: ConfigReader): void {
    if (this.#parent) {
      throw new Error('immutable');
    }

    const changed = !isEqual(this.#config.get(), config.get());
    this.#config = config;

    if (changed) {
      for (const subscriber of this.#subscribers) {
        try {
          subscriber();
        } catch (error: unknown) {
          console.error(`Config subscriber threw error, ${error}`);
        }
      }
    }
  }

  /**
   * Closes the config proxy, aborting any watchers.
   */
  close(): void {
    if (!this.#abortController) {
      throw new Error('Only the root config can be closed');
    }
    this.#abortController.abort();
  }

  /**
   * Subscribes to configuration changes.
   *
   * @param onChange - Callback to invoke when config changes
   * @returns A subscription object with an unsubscribe method
   */
  subscribe(onChange: () => void): { unsubscribe: () => void } {
    if (this.#parent) {
      return this.#parent.subscribe(onChange);
    }

    this.#subscribers.push(onChange);

    return {
      unsubscribe: () => {
        const index = this.#subscribers.indexOf(onChange);
        if (index >= 0) {
          this.#subscribers.splice(index, 1);
        }
      },
    };
  }

  #select(required: true): Config;
  #select(required: false): Config | undefined;
  #select(required: boolean): Config | undefined {
    if (this.#parent && this.#parentKey) {
      if (required) {
        return this.#parent.#select(true).getConfig(this.#parentKey);
      }
      return this.#parent.#select(false)?.getOptionalConfig(this.#parentKey);
    }
    return this.#config;
  }

  has(key: string): boolean {
    return this.#select(false)?.has(key) ?? false;
  }

  keys(): string[] {
    return this.#select(false)?.keys() ?? [];
  }

  get<T = unknown>(key?: string): T {
    return this.#select(true).get<T>(key);
  }

  getOptional<T = unknown>(key?: string): T | undefined {
    return this.#select(false)?.getOptional<T>(key);
  }

  getConfig(key: string): Config {
    return new ObservableConfigProxy(this, key);
  }

  getOptionalConfig(key: string): Config | undefined {
    if (this.#select(false)?.has(key)) {
      return new ObservableConfigProxy(this, key);
    }
    return undefined;
  }

  getConfigArray(key: string): Config[] {
    return this.#select(true).getConfigArray(key);
  }

  getOptionalConfigArray(key: string): Config[] | undefined {
    return this.#select(false)?.getOptionalConfigArray(key);
  }

  getNumber(key: string): number {
    return this.#select(true).getNumber(key);
  }

  getOptionalNumber(key: string): number | undefined {
    return this.#select(false)?.getOptionalNumber(key);
  }

  getBoolean(key: string): boolean {
    return this.#select(true).getBoolean(key);
  }

  getOptionalBoolean(key: string): boolean | undefined {
    return this.#select(false)?.getOptionalBoolean(key);
  }

  getString(key: string): string {
    return this.#select(true).getString(key);
  }

  getOptionalString(key: string): string | undefined {
    return this.#select(false)?.getOptionalString(key);
  }

  getStringArray(key: string): string[] {
    return this.#select(true).getStringArray(key);
  }

  getOptionalStringArray(key: string): string[] | undefined {
    return this.#select(false)?.getOptionalStringArray(key);
  }
}
