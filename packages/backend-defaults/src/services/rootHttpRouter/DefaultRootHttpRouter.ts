/*
 * Copyright 2023 The Backstage Authors
 * Modifications copyright 2024 Larder Software Limited
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
 * packages/backend-defaults/src/entrypoints/rootHttpRouter/DefaultRootHttpRouter.ts at v1.47.1, and modified.
 */

import { Router, RequestHandler } from 'express';
import trimEnd from 'lodash/trimEnd';
import type { RootHttpRouterService } from '@roadiehq/extensions-api';

function normalizePath(path: string): string {
  return `${trimEnd(path, '/')}/`;
}

export interface DefaultRootHttpRouterOptions {
  indexPath?: string | false;
}

/**
 * Default root HTTP router implementation.
 */
export class DefaultRootHttpRouter implements RootHttpRouterService {
  #indexPath: string | undefined;
  #router = Router();
  #namedRoutes = Router();
  #indexRouter = Router();
  #existingPaths: string[] = [];

  static create(options?: DefaultRootHttpRouterOptions): DefaultRootHttpRouter {
    let indexPath: string | undefined;
    if (options?.indexPath === false) {
      indexPath = undefined;
    } else if (options?.indexPath === undefined) {
      indexPath = '/api/app';
    } else if (options?.indexPath === '') {
      throw new Error('indexPath option may not be an empty string');
    } else {
      indexPath = options.indexPath;
    }
    return new DefaultRootHttpRouter(indexPath);
  }

  private constructor(indexPath: string | undefined) {
    this.#indexPath = indexPath;
    this.#router.use(this.#namedRoutes);
    this.#router.use('/api/', (_req, _res, next) => {
      next('router');
    });
    if (this.#indexPath) {
      this.#router.use(this.#indexRouter);
    }
  }

  use(path: string, handler: RequestHandler): void {
    if (path.match(/^[/\s]*$/)) {
      throw new Error('Root router path may not be empty');
    }

    const conflictingPath = this.#findConflictingPath(path);
    if (conflictingPath) {
      throw new Error(
        `Path ${path} conflicts with the existing path ${conflictingPath}`,
      );
    }

    this.#existingPaths.push(path);
    this.#namedRoutes.use(path, handler);

    if (this.#indexPath === path) {
      this.#indexRouter.use(handler);
    }
  }

  handler(): RequestHandler {
    return this.#router;
  }

  #findConflictingPath(newPath: string): string | undefined {
    const normalizedNewPath = normalizePath(newPath);
    for (const path of this.#existingPaths) {
      const normalizedPath = normalizePath(path);
      if (normalizedPath.startsWith(normalizedNewPath)) {
        return path;
      }
      if (normalizedNewPath.startsWith(normalizedPath)) {
        return path;
      }
    }
    return undefined;
  }
}
