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

import React from 'react';
import { isNodeFailureWrapper } from '../../../../api/workflow/parse-execution-error';
import { ErrorDisplay } from '../error-display';

export interface ExecutionFailureNoticeProps {
  /** The run's own error (`WorkflowExecution.error`), not a node's. */
  error?: string;
  /** True when a node row already renders its own error. */
  hasNodeError: boolean;
}

/**
 * The run-level failure. A sink's publish step runs after every node is
 * already marked completed, so this is the only place its error can surface —
 * without it the user sees a red run and nothing else.
 */
export function ExecutionFailureNotice({
  error,
  hasNodeError,
}: ExecutionFailureNoticeProps) {
  // When a node already shows the real error, the run-level string is just the
  // engine's "N node(s) failed during execution" wrapper — repeating it adds
  // nothing and pushes the actionable message off screen.
  if (hasNodeError && (!error || isNodeFailureWrapper(error))) {
    return null;
  }

  if (!error) {
    return (
      <p className="block px-3 py-1.5 text-xs text-destructive">
        Execution failed, but the engine reported no error. Check the Logs tab.
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-md border-l-[3px] border-l-destructive bg-destructive/[0.06] py-1.5 pr-3">
      <ErrorDisplay error={error} title="Execution failed" />
    </div>
  );
}
