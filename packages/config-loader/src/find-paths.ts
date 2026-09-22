/*
 * Copyright 2020 The Backstage Authors
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
 * packages/cli-common/src/paths.ts at v1.47.1, and modified.
 */

import fs from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * A function that takes a set of path fragments and resolves them into a
 * single complete path, relative to some root.
 */
type ResolveFunc = (...paths: string[]) => string;

/**
 * Common paths and resolve functions used by the cli.
 */
export type Paths = {
  ownDir: string;
  ownRoot: string;
  targetDir: string;
  targetRoot: string;
  resolveOwn: ResolveFunc;
  resolveOwnRoot: ResolveFunc;
  resolveTarget: ResolveFunc;
  resolveTargetRoot: ResolveFunc;
};

function findRootPath(
  searchDir: string,
  filterFunc: (packagePath: string) => boolean,
): string | undefined {
  let path = searchDir;

  for (let i = 0; i < 1000; i++) {
    const packagePath = resolve(path, 'package.json');
    const exists = fs.existsSync(packagePath);

    if (exists && filterFunc(packagePath)) {
      return path;
    }

    const newPath = dirname(path);
    if (newPath === path) {
      return undefined;
    }
    path = newPath;
  }

  throw new Error(
    `Iteration limit reached when searching for root package.json at ${searchDir}`,
  );
}

function findOwnDir(searchDir: string): string {
  const path = findRootPath(searchDir, () => true);
  if (!path) {
    throw new Error(
      `No package.json found while searching for package root of ${searchDir}`,
    );
  }
  return path;
}

function findOwnRootDir(ownDir: string): string {
  const isLocal = fs.existsSync(resolve(ownDir, 'src'));
  if (!isLocal) {
    throw new Error(
      'Tried to access monorepo package root dir outside of repository',
    );
  }
  return resolve(ownDir, '../..');
}

/**
 * Find paths related to a package and its execution context.
 */
export function findPaths(searchDir: string): Paths {
  const ownDir = findOwnDir(searchDir);
  const targetDir = fs
    .realpathSync(process.cwd())
    .replace(/^[a-z]:/, str => str.toLocaleUpperCase('en-US'));

  let ownRoot = '';
  const getOwnRoot = () => {
    if (!ownRoot) {
      ownRoot = findOwnRootDir(ownDir);
    }
    return ownRoot;
  };

  let targetRoot = '';
  const getTargetRoot = () => {
    if (!targetRoot) {
      targetRoot =
        findRootPath(targetDir, path => {
          try {
            const content = fs.readFileSync(path, 'utf8');
            const data = JSON.parse(content) as { workspaces?: unknown };
            return Boolean(data.workspaces);
          } catch (error) {
            throw new Error(
              `Failed to parse package.json file while searching for root, ${error}`,
            );
          }
        }) ?? targetDir;
    }
    return targetRoot;
  };

  return {
    ownDir,
    get ownRoot() {
      return getOwnRoot();
    },
    targetDir,
    get targetRoot() {
      return getTargetRoot();
    },
    resolveOwn: (...paths) => resolve(ownDir, ...paths),
    resolveOwnRoot: (...paths) => resolve(getOwnRoot(), ...paths),
    resolveTarget: (...paths) => resolve(targetDir, ...paths),
    resolveTargetRoot: (...paths) => resolve(getTargetRoot(), ...paths),
  };
}
