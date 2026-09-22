/*
 * Copyright 2025 Larder Software Limited
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

import { parseCsvParam } from '../../common/csv-param';
import { isContextGroupScopeId } from './context-group-scope';
import { ALL_DATA_SOURCES_ID } from './use-data-source-objects';

/**
 * The Datastore views' data-source scope, read from the URL.
 *
 * Shared with the route-level Suspense fallback, which needs to pick the same
 * column set as the page before the page's chunk has even loaded — the two
 * loading phases must show the same skeleton (loading-states rule #3).
 *
 * `?ds=<csv>` is the current form; an empty scope means every data source.
 * Legacy `?dataSourceId=` deep links still resolve, with `all` mapping to the
 * empty scope.
 */
export function readDatastoreScopeFromParams(
  params: URLSearchParams,
): string[] {
  const scope = parseCsvParam(params.get('ds'));
  if (scope.length > 0) {
    return scope;
  }
  const legacy = params.get('dataSourceId');
  if (legacy && legacy !== ALL_DATA_SOURCES_ID) {
    return [legacy];
  }
  return [];
}

/**
 * True when the scope spans more than one data source (or all of them), which is
 * the cross-source view: it gains a Data source column and drops the
 * per-datasource index columns, since the sources share no schema. A scope of
 * one context-group rule is also cross-source — its group rows span sources.
 */
export function isCrossSourceScope(scope: string[]): boolean {
  return scope.length !== 1 || isContextGroupScopeId(scope[0]);
}
