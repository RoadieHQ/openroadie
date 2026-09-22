import {
  StatusCell as UiStatusCell,
  StatusDot,
  type StatusIndicatorTone,
} from '@roadiehq/ui/status-indicator';

/**
 * Run/step status vocabulary shared by the data-source execution monitor and
 * the actions test-runner. A string-literal superset of the workflow
 * `ExecutionStatus` / `NodeExecutionStatus` unions, so this module stays free of
 * any workflow-api coupling while remaining assignable from both.
 */
export type StatusValue =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export function getStatusLabel(status: StatusValue): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'running':
      return 'Running';
    case 'cancelled':
      return 'Cancelled';
    case 'pending':
      return 'Pending';
    case 'skipped':
      return 'Skipped';
    default:
      return status;
  }
}

/** Map the run/step status vocabulary onto the ui primitive's semantic tones. */
function getIndicatorTone(status: StatusValue): StatusIndicatorTone {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'destructive';
    case 'running':
      return 'info';
    case 'cancelled':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function StatusIcon({ status }: { status: StatusValue }): JSX.Element {
  return (
    <StatusDot tone={getIndicatorTone(status)} pulse={status === 'running'} />
  );
}

export function StatusCell({
  status,
  className,
}: {
  status: StatusValue;
  className?: string;
}) {
  return (
    <UiStatusCell
      tone={getIndicatorTone(status)}
      pulse={status === 'running'}
      label={getStatusLabel(status)}
      className={className}
    />
  );
}
