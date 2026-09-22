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

import { Expression } from 'jsonata';
import type { ExpressionClass } from './classifyExpression';

/**
 * Normalize a JSONata evaluation result to an array. JSONata returns a bare
 * scalar for a single result and `undefined` for no match; downstream stages
 * always expect an array. Mirrors the map/filter node convention in
 * `src/nodes/`: `undefined` → `[]`, an existing array passes through, any other
 * scalar is wrapped in a single-element array.
 */
export function normalizeToArray(result: unknown): unknown[] {
  if (result === undefined) return [];
  // JSONata returns a `Sequence` — an Array subclass carrying internal flags
  // (`sequence`, `keepSingleton`). Copy into a plain array so downstream
  // consumers (and equality checks) see a clean array, not the wrapper.
  if (Array.isArray(result)) return [...result];
  return [result];
}

/**
 * Evaluate a per-page-safe expression against each input page independently,
 * yielding the normalized array result for that page. Bounded memory: only one
 * page is held at a time. The caller is responsible for having classified the
 * expression as `per-page` first (see {@link classifyExpression}); evaluating a
 * blocking expression this way would silently produce wrong results.
 */
export async function* evaluatePerPage(
  compiled: Expression,
  pages: AsyncIterable<unknown[]>,
): AsyncIterable<unknown[]> {
  for await (const page of pages) {
    const result = await compiled.evaluate(page);
    yield normalizeToArray(result);
  }
}

/**
 * Thrown by {@link evaluateBlocking} when the materialized input exceeds the
 * cap. Carries the structured context needed to diagnose and remediate without
 * reading logs: the offending expression, its classification, and the cap.
 */
export class BlockingEvaluationCapError extends Error {
  readonly expression: string;
  readonly classification: ExpressionClass;
  readonly cap: number;

  constructor(args: {
    expression: string;
    classification: ExpressionClass;
    cap: number;
  }) {
    const { expression, classification, cap } = args;
    super(
      `JSONata expression requires the whole input to be materialized ` +
        `(classified "${classification}") but the input exceeded the cap of ` +
        `${cap} item${cap === 1 ? '' : 's'}. Expression: ${expression}. ` +
        `Remediation: restructure the expression to per-item form ` +
        `(a filter, field/object mapping, or per-item function evaluated ` +
        `independently per record) so it can stream page-by-page, or reduce ` +
        `the dataset feeding this step (e.g. filter earlier in the pipeline).`,
    );
    this.name = 'BlockingEvaluationCapError';
    this.expression = expression;
    this.classification = classification;
    this.cap = cap;
    // Restore prototype chain for `instanceof` across the transpile target.
    Object.setPrototypeOf(this, BlockingEvaluationCapError.prototype);
  }
}

/**
 * Evaluate a blocking expression by first materializing every input page into a
 * single array, then evaluating the expression once against the whole array.
 *
 * Materialization is capped: as soon as the accumulated item count would exceed
 * `cap`, a {@link BlockingEvaluationCapError} is thrown (before pulling further
 * pages), naming the expression, its classification, and the cap. Under the cap
 * the normalized array result is returned.
 */
export async function evaluateBlocking(
  compiled: Expression,
  pages: AsyncIterable<unknown[]>,
  cap: number,
  expression: string,
): Promise<unknown[]> {
  const materialized: unknown[] = [];
  for await (const page of pages) {
    if (materialized.length + page.length > cap) {
      throw new BlockingEvaluationCapError({
        expression,
        classification: 'blocking',
        cap,
      });
    }
    for (const item of page) {
      materialized.push(item);
    }
  }

  const result = await compiled.evaluate(materialized);
  return normalizeToArray(result);
}
