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

/** Postgres unique-violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = '23505';

interface PgErrorFields {
  code?: unknown;
  constraint?: unknown;
}

/**
 * True when `e` is a Postgres unique-constraint violation.
 *
 * Knex passes the driver error through untouched, so the SQLSTATE code is the
 * reliable signal — matching on the message text breaks under a different
 * driver or locale.
 */
export function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as PgErrorFields).code === PG_UNIQUE_VIOLATION
  );
}

/**
 * The constraint a unique violation fired on, when the driver reports it.
 *
 * Needed where a table carries more than one unique constraint and the error
 * must name the right column — `context_group_rule` is unique on both `name`
 * and `slug`, so a slug collision must not be reported against the name.
 */
export function uniqueViolationConstraint(e: unknown): string | undefined {
  if (!isUniqueViolation(e)) return undefined;
  const { constraint } = e as PgErrorFields;
  return typeof constraint === 'string' ? constraint : undefined;
}
