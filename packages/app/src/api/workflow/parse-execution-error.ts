function isUsefulString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    value !== '[object Object]'
  );
}

function stringifyErrorValue(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (isUsefulString(value)) {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value !== 'object') {
    return undefined;
  }
  try {
    if (value instanceof Error) {
      const extra = Object.fromEntries(
        Object.entries(Object.assign({}, value)).filter(
          ([key]) => key !== 'name' && key !== 'message' && key !== 'stack',
        ),
      );
      const payload: Record<string, unknown> = {
        name: value.name,
        ...extra,
      };
      if (isUsefulString(value.message)) {
        payload.message = value.message;
      }
      const json = JSON.stringify(payload);
      return json && json !== '{}' ? json : undefined;
    }
    const json = JSON.stringify(value);
    return json && json !== '{}' && json !== '[object Object]'
      ? json
      : undefined;
  } catch {
    return undefined;
  }
}

export function formatErrorString(error: unknown): string {
  if (isUsefulString(error)) {
    return error;
  }
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    let detail: string | undefined;
    if (isUsefulString(obj.message)) {
      detail = obj.message;
    } else if (obj.message !== undefined) {
      detail = stringifyErrorValue(obj.message);
    }
    if (!detail && obj.cause !== undefined) {
      const caused = formatErrorString(obj.cause);
      if (caused !== 'Unknown error') {
        detail = caused;
      }
    }
    if (!detail) {
      detail = stringifyErrorValue(error);
    }
    if (!detail && error instanceof Error && error.name) {
      detail = error.name;
    }
    if (detail) {
      const status =
        typeof obj.statusCode === 'number'
          ? obj.statusCode
          : typeof obj.status === 'number'
            ? obj.status
            : undefined;
      if (status != null && !detail.includes(String(status))) {
        return `HTTP ${status}: ${detail}`;
      }
      return detail;
    }
  }
  const fallback = String(error);
  return fallback === '[object Object]' ? 'Unknown error' : fallback;
}

export interface ParsedError {
  summary: string;
  suggestion?: string;
  details: string;
}

interface ErrorPattern {
  test: (error: string) => boolean;
  summary: string;
  suggestion?: string;
}

const hasStatus = (error: string, status: number) =>
  error.startsWith(`Request failed: ${status} `);

/**
 * Backend errors arrive as `SomeError: message` — and persisted run errors
 * carry the whole stack, so the class name is the first thing a user reads.
 * Stripped for the summary only; `details` keeps the raw string.
 */
const ERROR_CLASS_PREFIX = /^(?:[A-Z][A-Za-z0-9_$]*Error|Error):\s*/;

/**
 * True for the engine's run-level "N node(s) failed during execution" — a
 * count, not a cause. Callers that already render the failing node's own error
 * should suppress this rather than show both.
 */
export function isNodeFailureWrapper(error: string): boolean {
  return /^\d+ node\(s\) failed during execution/.test(
    error.replace(ERROR_CLASS_PREFIX, ''),
  );
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    test: e => hasStatus(e, 401) && /bad credentials/i.test(e),
    summary: 'Authentication failed — invalid or expired token (401)',
    suggestion: 'Update your token in Administration > Integration Settings',
  },
  {
    test: e => hasStatus(e, 401),
    summary: 'Authentication failed (401)',
    suggestion: 'Check your token in Administration > Integration Settings',
  },
  {
    test: e => hasStatus(e, 403) && /rate limit/i.test(e),
    summary: 'API rate limit exceeded (403)',
    suggestion: 'Wait a few minutes before retrying',
  },
  {
    test: e => hasStatus(e, 403),
    summary: 'Access denied — insufficient permissions (403)',
    suggestion: 'Check that your token has the required scopes',
  },
  {
    test: e => hasStatus(e, 404),
    summary: 'Resource not found (404)',
    suggestion: 'Check the API path and organization/repo name',
  },
  {
    test: e => hasStatus(e, 429),
    summary: 'Rate limited by the API (429)',
    suggestion: 'Wait before retrying — consider reducing request frequency',
  },
  {
    test: e => /^Request failed: 5\d{2} /.test(e),
    summary: 'External service error',
    suggestion: 'The remote API returned a server error — try again later',
  },
  {
    test: e => /not authorized to perform.*sts:AssumeRole/i.test(e),
    summary: 'AWS role assumption denied',
    suggestion:
      "Check that the IAM role's trust policy allows Roadie to assume it and verify the role name and account ID are correct",
  },
  {
    test: e =>
      /AWS credential resolution failed/i.test(e) &&
      /Could not load credentials/i.test(e),
    summary: 'AWS credentials unavailable',
    suggestion:
      'No AWS credentials could be loaded — verify the IAM role and service account configuration',
  },
  {
    test: e => /AWS credential resolution failed/i.test(e),
    summary: 'Failed to resolve AWS credentials',
    suggestion:
      'Check the IAM role name, account ID, and trust policy in your AWS integration settings',
  },
  {
    test: e =>
      /ExpiredTokenException|security token.*(?:invalid|expired)/i.test(e),
    summary: 'AWS security token expired or invalid',
    suggestion:
      'The AWS session token has expired or is invalid — try re-running the datasource',
  },
  {
    test: e =>
      /is not authorized to perform:/i.test(e) && !/sts:AssumeRole/i.test(e),
    summary: 'AWS permission denied',
    suggestion:
      "The assumed IAM role does not have permission for this action — add the required permissions to the role's IAM policy",
  },
  {
    test: e =>
      /AccessDenied|AccessDeniedException/i.test(e) &&
      /aws|arn:|cloud.?control/i.test(e),
    summary: 'AWS access denied',
    suggestion:
      'Check that the assumed IAM role has the required permissions for the target AWS service and resources',
  },
  {
    test: e => /AWS request failed: 403/i.test(e),
    summary: 'AWS access denied (403)',
    suggestion:
      "The IAM role does not have permission to perform this operation — check the role's IAM policy",
  },
  {
    test: e => /ECONNREFUSED/.test(e),
    summary: 'Connection refused',
    suggestion: 'Check the integration host URL is correct and reachable',
  },
  {
    test: e => /ETIMEDOUT|ESOCKETTIMEDOUT/.test(e),
    summary: 'Request timed out',
    suggestion: 'The remote service took too long to respond',
  },
  {
    test: e => /ENOTFOUND/.test(e),
    summary: 'Host not found',
    suggestion: 'Check the integration host URL — DNS resolution failed',
  },
  // Sink / publish failures. These are the run's own errors rather than a
  // node's, so without a mapping here the user gets a bare "Execution failed".
  {
    test: e =>
      /Duplicate objectId values:/i.test(e) ||
      /produced duplicate values?:/i.test(e),
    summary: 'Duplicate object IDs — the ID selector is not unique',
    suggestion:
      'Two or more items resolved to the same object ID. Either make the ID unique with a compound JSONata expression (e.g. $string(_parent.id) & "-" & $string($.id)), or change the sink\'s collision handling to keep one row, append, or expand.',
  },
  {
    test: e => /have no object_id/i.test(e),
    summary: 'Some items produced no object ID',
    suggestion:
      "Check the sink's ID selector — it must resolve to a string for every item.",
  },
  {
    test: e => /Staging manifest mismatch/i.test(e),
    summary:
      'Publish aborted — staged data was lost before it could be written',
    suggestion:
      'Usually a database failover mid-run. Nothing was written; re-run the data source.',
  },
  {
    test: e =>
      /Index configuration .* (?:changed|added|removed) during the run/i.test(
        e,
      ),
    summary: 'Publish aborted — indexes changed while the run was in progress',
    suggestion:
      'An index configuration was edited after this run started. Nothing was written; re-run the data source.',
  },
  {
    test: e => /not active; refusing to publish/i.test(e),
    summary: 'Publish aborted — superseded by a newer run',
    suggestion: 'A newer run took over. Check the most recent run instead.',
  },
  {
    test: e => /Failed to write results to staging/i.test(e),
    summary: 'Failed to write results to staging',
    suggestion:
      'A database error interrupted the run — re-run the data source.',
  },
  {
    test: e => /refusing to publish|PublishAbortedError/.test(e),
    summary: 'Publish aborted — nothing was written to the datastore',
    suggestion: 'The existing data was left unchanged.',
  },
  {
    test: e => /Datastore sink expected an array of JSON objects/i.test(e),
    summary: "The sink received data that isn't a list of objects",
    suggestion:
      "Check the sink's items selector — it must resolve to an array of JSON objects.",
  },
  {
    test: e => /Execution timed out after/i.test(e),
    summary: 'Execution timed out',
    suggestion:
      'The run exceeded the time limit — narrow the source query or reduce the amount of data fetched.',
  },
  // The run-level wrapper the engine emits when a node threw. The real error is
  // on the node, so point there rather than repeating a count.
  {
    test: isNodeFailureWrapper,
    summary: 'A step in this data source failed',
    suggestion: 'See the highlighted step above for the underlying error.',
  },
];

export function parseExecutionError(raw: string): ParsedError {
  const normalized = raw.replace(ERROR_CLASS_PREFIX, '');
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        summary: pattern.summary,
        suggestion: pattern.suggestion,
        details: raw,
      };
    }
  }

  const firstLine = normalized.split('\n')[0];
  return {
    summary:
      firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine,
    details: raw,
  };
}
