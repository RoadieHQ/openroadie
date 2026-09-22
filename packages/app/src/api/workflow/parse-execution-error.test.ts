/*
 * Copyright 2026 Larder Software Limited
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

import { describe, expect, it } from 'vitest';
import {
  formatErrorString,
  parseExecutionError,
} from './parse-execution-error';

describe('formatErrorString', () => {
  it('returns a string error unchanged', () => {
    expect(formatErrorString('boom')).toBe('boom');
  });

  it('prefers an object message', () => {
    expect(formatErrorString(new Error('boom'))).toBe('boom');
  });

  it('stringifies a nested object message instead of [object Object]', () => {
    expect(
      formatErrorString({ message: { code: '42P01', detail: 'missing' } }),
    ).toBe('{"code":"42P01","detail":"missing"}');
  });

  it('stringifies a thrown plain object', () => {
    expect(formatErrorString({ status: 502, error: 'bad gateway' })).toBe(
      '{"status":502,"error":"bad gateway"}',
    );
  });

  it('prefixes HTTP status from ResponseError-shaped objects', () => {
    const error = Object.assign(
      new Error('relation "objects" does not exist'),
      {
        name: 'ResponseError',
        statusCode: 500,
      },
    );
    expect(formatErrorString(error)).toBe(
      'HTTP 500: relation "objects" does not exist',
    );
  });

  it('does not duplicate a status already present in the message', () => {
    const error = Object.assign(
      new Error('Request failed with status 500 Internal Server Error'),
      { statusCode: 500 },
    );
    expect(formatErrorString(error)).toBe(
      'Request failed with status 500 Internal Server Error',
    );
  });

  it('falls back to enumerable fields when Error.message is [object Object]', () => {
    const error = Object.assign(new Error({} as unknown as string), {
      statusCode: 500,
      code: 'ECONNRESET',
    });
    expect(error.message).toBe('[object Object]');
    expect(formatErrorString(error)).toContain('500');
    expect(formatErrorString(error)).toContain('ECONNRESET');
    expect(formatErrorString(error)).not.toBe('[object Object]');
  });
});

describe('parseExecutionError', () => {
  describe('duplicate object ids', () => {
    // The message the staged publisher throws, stack and all.
    const staged = [
      'PublishAbortedError: Duplicate objectId values: 348b8666, 482723ca. Prefer a compound unique index (JSONata), e.g. $string(_parent.id) & "-" & $string($.id).',
      '    at StagedPublisher.finalize (/app/packages/backend/dist/worker.js:326089:17)',
    ].join('\n');

    it('summarises the cause and suggests a fix', () => {
      const parsed = parseExecutionError(staged);
      expect(parsed.summary).toBe(
        'Duplicate object IDs — the ID selector is not unique',
      );
      expect(parsed.suggestion).toMatch(/compound JSONata expression/);
      expect(parsed.suggestion).toMatch(/collision handling/);
    });

    it('keeps the raw string, stack included, as details', () => {
      expect(parseExecutionError(staged).details).toBe(staged);
    });

    it('matches the legacy sink phrasing too', () => {
      const legacy =
        'Index expression "$.sha" produced duplicate values: 348b8666, 482723ca. Prefer a compound unique index (JSONata).';
      expect(parseExecutionError(legacy).summary).toBe(
        'Duplicate object IDs — the ID selector is not unique',
      );
    });
  });

  it.each([
    [
      'Staging manifest mismatch for node sink-1 (rows 10/12, index rows 10/12); refusing to publish',
      'Publish aborted — staged data was lost before it could be written',
    ],
    [
      'Index configuration "id" changed during the run; refusing to publish against a stale snapshot',
      'Publish aborted — indexes changed while the run was in progress',
    ],
    [
      'Attempt abc is superseded, not active; refusing to publish (execution xyz)',
      'Publish aborted — superseded by a newer run',
    ],
    [
      '3 staged row(s) for node sink-1 have no object_id; the sink must evaluate ids at spill time',
      'Some items produced no object ID',
    ],
    [
      'Failed to write results to staging: connection terminated',
      'Failed to write results to staging',
    ],
    [
      'Datastore sink expected an array of JSON objects but received object (null)',
      "The sink received data that isn't a list of objects",
    ],
    ['Execution timed out after 900000ms', 'Execution timed out'],
  ])('maps %j to a specific summary', (raw, summary) => {
    const parsed = parseExecutionError(raw);
    expect(parsed.summary).toBe(summary);
    expect(parsed.suggestion).toBeTruthy();
  });

  it('falls back to a generic publish-aborted summary for unmapped gates', () => {
    const parsed = parseExecutionError(
      'PublishAbortedError: No staging manifest recorded for the attempt; refusing to publish',
    );
    expect(parsed.summary).toBe(
      'Publish aborted — nothing was written to the datastore',
    );
  });

  it('points at the failing step for the run-level node wrapper', () => {
    const parsed = parseExecutionError('1 node(s) failed during execution');
    expect(parsed.summary).toBe('A step in this data source failed');
    expect(parsed.suggestion).toMatch(/highlighted step/);
  });

  it('strips the error class name from an unmapped summary', () => {
    const parsed = parseExecutionError('TypeError: x is not a function');
    expect(parsed.summary).toBe('x is not a function');
    expect(parsed.details).toBe('TypeError: x is not a function');
  });

  it('still recognises an HTTP status behind a class prefix', () => {
    expect(
      parseExecutionError('Error: Request failed: 401 Bad credentials').summary,
    ).toBe('Authentication failed — invalid or expired token (401)');
  });

  it('truncates a long unmapped first line', () => {
    const parsed = parseExecutionError('x'.repeat(200));
    expect(parsed.summary).toHaveLength(123);
    expect(parsed.summary.endsWith('...')).toBe(true);
  });
});
