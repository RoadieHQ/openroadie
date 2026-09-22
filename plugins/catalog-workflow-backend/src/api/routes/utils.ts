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

import express from 'express';
import { callerPrincipal, HttpAuthService } from '@roadiehq/extensions-api';
import { validate as validateUuid } from 'uuid';
import { DateTime } from 'luxon';
import {
  WorkflowType,
  WORKFLOW_TYPES,
  isWorkflowType,
} from '@roadiehq/catalog-workflow-common';
import { SLUG_RE } from '@roadiehq/scopes';

export type ParseResult =
  | { value: number | undefined; error?: never }
  | { value?: never; error: string };

export type ParseDateResult =
  | { value: string | undefined; error?: never }
  | { value?: never; error: string };

export function parseNumericParam(
  value: unknown,
  paramName: string,
): ParseResult {
  if (value === undefined || value === null || value === '') {
    return { value: undefined };
  }
  const num = Number(value);
  if (Number.isNaN(num) || num < 0 || !Number.isInteger(num)) {
    return { error: `Invalid ${paramName}: must be a non-negative integer` };
  }
  return { value: num };
}

export function parseDateTimeParam(
  value: unknown,
  paramName: string,
): ParseDateResult {
  if (value === undefined || value === null || value === '') {
    return { value: undefined };
  }

  if (typeof value !== 'string') {
    return { error: `Invalid ${paramName}: must be an ISO date string` };
  }

  const parsed = DateTime.fromISO(value);
  if (!parsed.isValid) {
    return { error: `Invalid ${paramName}: must be an ISO date string` };
  }

  return { value: parsed.toISO()! };
}

export function parseWorkflowType(
  value: unknown,
  required = false,
): { value?: WorkflowType; error?: string } {
  if (value === undefined || value === null || value === '') {
    if (required) {
      return {
        error: `Invalid workflowType: must be one of ${WORKFLOW_TYPES.join(
          ', ',
        )}`,
      };
    }
    return {};
  }
  if (!isWorkflowType(value)) {
    return {
      error: `Invalid workflowType: must be one of ${WORKFLOW_TYPES.join(
        ', ',
      )}`,
    };
  }
  return { value };
}

/**
 * Validate an optional `slug` field off a request body.
 *
 * A slug that doesn't match the grammar can never appear in a
 * `@datasource:<slug>` reference token, nor be granted as a service-token
 * target — so an unreferenceable data source is rejected at the edge rather
 * than stored and silently unusable. Absent is fine; the DAO derives one.
 */
export function parseSlug(value: unknown): {
  value?: string;
  error?: string;
} {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'string') {
    return { error: 'slug must be a string' };
  }
  const trimmed = value.trim();
  if (!SLUG_RE.test(trimmed)) {
    return {
      error: 'Invalid slug: use lowercase letters, numbers and single hyphens',
    };
  }
  return { value: trimmed };
}

export function validateExecutionId(id: string | undefined): string | null {
  if (!id || !validateUuid(id)) {
    return 'Invalid execution ID';
  }
  return null;
}

export function createGetUserId(httpAuth: HttpAuthService) {
  return async function getUserId(
    req: express.Request,
  ): Promise<string | undefined> {
    return (await callerPrincipal(httpAuth, req))?.userId;
  };
}
