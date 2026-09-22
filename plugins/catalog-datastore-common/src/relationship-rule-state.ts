/*
 * Copyright 2026 Larder Software Ltd.
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
import type { RelationshipRuleState } from './types';

/**
 * The one-way verbs a relationship rule's state can be moved by. Each 409s
 * unless the rule is in its exact source state:
 *
 *   suggested --approve--> active     active   --disable--> inactive
 *   suggested --dismiss--> inactive   inactive --reset----> suggested
 */
export const RELATIONSHIP_RULE_TRANSITIONS = [
  'approve',
  'dismiss',
  'disable',
  'reset',
] as const;

export type RelationshipRuleTransition =
  (typeof RELATIONSHIP_RULE_TRANSITIONS)[number];

/** Where each verb leaves the rule. */
export const STATE_AFTER_TRANSITION: Record<
  RelationshipRuleTransition,
  RelationshipRuleState
> = {
  approve: 'active',
  dismiss: 'inactive',
  disable: 'inactive',
  reset: 'suggested',
};

/**
 * The verbs to run, in order, to move a rule from one state to another. Two of
 * the six moves need a second hop (there is no edge from `active` back to
 * `suggested`, nor from `inactive` straight to `active`), which is why the paths
 * are spelled out rather than derived at each call site.
 *
 * Shared deliberately: the state setter route, the CLI's bundle importer and any
 * IaC client all have to agree on these paths, and three copies of this table
 * would drift the moment a state is added.
 */
export const RELATIONSHIP_RULE_STATE_PATHS: Record<
  RelationshipRuleState,
  Record<RelationshipRuleState, readonly RelationshipRuleTransition[]>
> = {
  suggested: { suggested: [], active: ['approve'], inactive: ['dismiss'] },
  active: {
    suggested: ['disable', 'reset'],
    active: [],
    inactive: ['disable'],
  },
  inactive: {
    suggested: ['reset'],
    active: ['reset', 'approve'],
    inactive: [],
  },
};

export function isRelationshipRuleState(
  value: unknown,
): value is RelationshipRuleState {
  return value === 'suggested' || value === 'active' || value === 'inactive';
}

/**
 * The transitions that move a rule from `from` to `to`. Empty when the rule is
 * already there — callers treat that as a no-op success, which is what makes a
 * state setter idempotent.
 */
export function relationshipRuleStatePath(
  from: RelationshipRuleState,
  to: RelationshipRuleState,
): readonly RelationshipRuleTransition[] {
  return RELATIONSHIP_RULE_STATE_PATHS[`${from}`][`${to}`];
}
