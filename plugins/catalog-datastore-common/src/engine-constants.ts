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

export const PAGE_SIZE = 1000;

export const BLOCKING_OP_CAP = 100_000;

export const SAMPLE_ITEMS = 50;

export const SAMPLE_BYTES = 256 * 1024;

export const APPEND_KEEP = 20;

export const CHAINED_CONCURRENCY = 5;

export const CHAINED_CONCURRENCY_MAX = 20;

export const FAILURE_RATE_LIMIT = 0.1;

export const ENRICH_CHILD_CAP = 100;

export const ATTEMPT_HEARTBEAT_INTERVAL_MS = 30_000;

export const ATTEMPT_STALE_AFTER_MS = 120_000;

export const SCHEMA_SAMPLE_ITEMS = 100;
export type AttemptState =
  | 'active'
  | 'superseded'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const ATTEMPT_STAGING_GRACE_MS = 60_000;

export const EXECUTION_EVENT_MAX_BYTES = 8 * 1024;

/** Ring-buffer cap on the in-process event buffer kept per execution. */
export const EXECUTION_EVENT_BUFFER_CAP = 2000;

/** Ring-buffer cap on in-memory request logs kept for dry-run executions. */
export const REQUEST_LOG_BUFFER_CAP = 500;

/**
 * Advisory-lock namespace serializing a datasource's staged publish against
 * concurrent publishes AND against index-configuration creation
 * (`createIndexConfiguration` backfills index rows from the datastore rows it
 * can see, so it must not interleave with a publish rewriting those rows).
 * Lock key: `hashtext(DATASOURCE_PUBLISH_LOCK_NS + datasourceId)`.
 */
export const DATASOURCE_PUBLISH_LOCK_NS = 'datasource-publish:';

/**
 * Advisory-lock namespace serializing a rule's context-group materialization.
 * A rebuild is delete-then-insert of the rule's whole group set in one
 * transaction; without the lock a concurrent rebuild's DELETE cannot see the
 * other's uncommitted inserts (read committed), so both sets commit and every
 * object lands in two groups. Lock key:
 * `hashtext(CONTEXT_GROUP_MATERIALIZE_LOCK_NS + ruleId)`.
 */
export const CONTEXT_GROUP_MATERIALIZE_LOCK_NS = 'context-group-materialize:';
