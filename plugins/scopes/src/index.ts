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
export {
  SCOPES,
  SCOPE_ACTIONS,
  scope,
  SLUG_RE,
  SLUG_SOURCE,
  isValidSlug,
  type ScopeAction,
} from '@roadiehq/scopes-common';
export {
  ALL_SCOPES,
  createScopeChecker,
  type GrantedScopes,
  type ScopeChecker,
} from './checker';
export {
  allowAllScopeService,
  createScopeService,
  resolveAllowedTargets,
  isTargetAllowed,
  scopeServiceRef,
  type ScopeRetriever,
  type ScopeService,
} from './service';
export {
  createScopeGuard,
  createScopeFamilyGuard,
  type RequireScopes,
  type RequireScopeFamily,
} from './createScopeGuard';
