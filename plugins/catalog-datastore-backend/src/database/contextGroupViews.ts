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
import {
  validateLiquidTemplate,
  type LiquidParseIssue,
} from '@roadiehq/liquid-safe';
import { workspaceOwnershipFields } from '@roadiehq/workspaces-backend';

export interface ContextGroupViewRow {
  id: string;
  rule_id: string;
  name: string;
  description: string | null;
  template: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ContextGroupView {
  id: string;
  workspaceId: string;
  ownership: 'org' | 'workspace';
  ruleId: string;
  name: string;
  description: string | null;
  template: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export function rowToView(
  row: ContextGroupViewRow,
  workspaceId: string,
): ContextGroupView {
  return {
    id: row.id,
    ...workspaceOwnershipFields(workspaceId),
    ruleId: row.rule_id,
    name: row.name,
    description: row.description,
    template: row.template,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Data functions the render path provides to templates as Liquid filters. */
export const VIEW_DATA_FUNCTIONS = ['related', 'object'] as const;

export const DEFAULT_VIEW_NAME = 'default';
export const DEFAULT_VIEW_DESCRIPTION =
  'Shows everything in the context group.';

/**
 * The generated default template: a JSON document keyed by data source, built
 * with an explicit loop so the template itself shows what's available — the
 * data-source keys (`entry[0]`), each member's object data, and graph
 * navigation via the `related` data function. Group and rule identity ride in
 * the bundle response envelope, not the template. It loops over the `members`
 * map rather than naming datasources, so it stays correct when a rule's
 * datasources change. The `json: 2, 6` filter's second argument is the column
 * the value sits at — liquid-safe's `json` prefixes continuation lines with it
 * so nested JSON stays aligned with the surrounding document. Duplicated in
 * the `20260806120000_context_group_projection_table` migration backfill
 * (frozen, old indentation) and the
 * `20260818120000_reindent_default_view_template` migration that rewrites
 * unedited copies of it.
 */
export const DEFAULT_VIEW_TEMPLATE = `{
{% for entry in members %}  {{ entry[0] | json }}: [
{% for member in entry[1] %}    {
      "objectId": {{ member.objectId | json }},
      "data": {{ member.data | json: 2, 6 }},
      "related": {{ member | related | json: 2, 6 }}
    }{% unless forloop.last %},{% endunless %}
{% endfor %}  ]{% unless forloop.last %},{% endunless %}
{% endfor %}}`;

export class ViewValidationError extends Error {
  constructor(public readonly issues: LiquidParseIssue[]) {
    super(
      `Invalid view template: ${issues
        .map(i =>
          i.line !== undefined
            ? `${i.message} (line ${i.line}, col ${i.col})`
            : i.message,
        )
        .join('; ')}`,
    );
    this.name = 'ViewValidationError';
  }
}

export class ViewNotFoundError extends Error {
  constructor(name: string) {
    super(`View "${name}" not found`);
    this.name = 'ViewNotFoundError';
  }
}

/** Parse-validate a view template; throws ViewValidationError. */
export function assertValidViewTemplate(template: string): void {
  if (!template.trim()) {
    throw new ViewValidationError([{ message: 'Template must not be empty' }]);
  }
  const issues = validateLiquidTemplate(template, [...VIEW_DATA_FUNCTIONS]);
  if (issues.length > 0) {
    throw new ViewValidationError(issues);
  }
}

const VIEW_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** View names are request handles (`?view=<name>`): slug-shaped. */
export function assertValidViewName(name: string): void {
  if (!VIEW_NAME_PATTERN.test(name)) {
    throw new ViewValidationError([
      {
        message: `View name "${name}" must be lowercase alphanumeric with hyphens (e.g. "identifiers-only")`,
      },
    ]);
  }
}
