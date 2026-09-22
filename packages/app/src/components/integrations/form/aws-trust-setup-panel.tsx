import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { CopyButton } from '@roadiehq/ui/copy-button';
import { Alert, AlertDescription } from '@roadiehq/ui/alert';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { useWorkflows } from '../../../api';
import type { AwsTrustSetup } from '../../../api/workflow/workflow-client';
import { workspaceQueryKey } from '../../../api/workspace-scope';

interface AwsTrustSetupPanelProps {
  /** Absent for an unsaved integration — the values need a persisted id. */
  integrationId?: string;
}

function buildTrustPolicy(
  setup: Pick<AwsTrustSetup, 'principalArn'> & {
    externalId?: string;
    sourceIdentity?: string;
  },
): string {
  const principal =
    setup.principalArn ?? '<Roadie principal — contact support>';

  // Two statements, not one: sts:ExternalId is only a populated condition key
  // while AWS evaluates sts:AssumeRole — it isn't relevant to (and isn't set
  // during) the separate sts:SetSourceIdentity check. A single statement with
  // both actions under one Condition block evaluates that condition against
  // sts:SetSourceIdentity too, where sts:ExternalId is absent from context, so
  // StringEquals fails and every assume that sends a source identity is
  // denied — even though the same statement grants AssumeRole. Splitting them
  // is AWS's own documented pattern for combining the two.
  return JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowAssumeRole',
          Effect: 'Allow',
          Principal: { AWS: principal },
          Action: 'sts:AssumeRole',
          ...(setup.externalId && {
            Condition: { StringEquals: { 'sts:ExternalId': setup.externalId } },
          }),
        },
        {
          Sid: 'AllowSetSourceIdentity',
          Effect: 'Allow',
          Principal: { AWS: principal },
          // Granted unconditionally when Roadie sends no source identity yet:
          // it's a permission, not a requirement, so it's inert until Roadie
          // starts sending one — and mandatory the moment it does. Granting it
          // up front is what stops that cutover breaking the assume.
          Action: 'sts:SetSourceIdentity',
          ...(setup.sourceIdentity && {
            Condition: {
              StringEquals: { 'sts:SourceIdentity': setup.sourceIdentity },
            },
          }),
        },
      ],
    },
    null,
    2,
  );
}

function TrustPolicyBlock({
  label,
  policy,
}: {
  label: string;
  policy: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <CopyButton value={policy} label={`Copy ${label}`} />
      </div>
      <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs">
        {policy}
      </pre>
    </div>
  );
}

function TrustValue({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <CopyButton value={value} label={`Copy ${label}`} />
      </div>
      <code className="block rounded bg-muted px-2 py-1 font-mono text-xs break-all">
        {value}
      </code>
      {description ? (
        <p className="text-xs leading-normal text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Shared so the panel and the External ID field read one cache entry rather
 * than issuing the same request twice per account.
 */
export function useAwsTrustSetup(integrationId?: string) {
  const workflowApi = useWorkflows();

  return useQuery({
    queryKey: workspaceQueryKey(
      'integrations',
      'aws-trust-setup',
      integrationId,
    ),
    queryFn: async () =>
      (await workflowApi.integrations.getAwsTrustSetup(integrationId ?? '')) ??
      null,
    enabled: Boolean(integrationId),
  });
}

/**
 * Read-only panel giving the customer the exact values to put in their AWS
 * trust policy. Every value comes from the server, which derives them from the
 * same policy object that performs the assume — so what is shown here and what
 * STS receives cannot disagree.
 */
export function AwsTrustSetupPanel({ integrationId }: AwsTrustSetupPanelProps) {
  const { data, isLoading, error } = useAwsTrustSetup(integrationId);

  if (!integrationId) {
    return (
      <p className="text-xs leading-normal text-muted-foreground">
        Save this integration to see the trust policy values.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertDescription>
          {error instanceof Error
            ? error.message
            : 'Could not load the trust policy values.'}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {data.principalArn ? (
          <TrustValue
            label="Roadie principal"
            value={data.principalArn}
            description="Trust this IAM principal in your role's trust policy."
          />
        ) : null}
        {data.externalId ? (
          <TrustValue
            label="External ID"
            value={data.externalId}
            description="Require it with an sts:ExternalId condition."
          />
        ) : null}
        {data.sourceIdentity ? (
          <TrustValue
            label="Source identity"
            value={data.sourceIdentity}
            description="Your role's trust policy must allow sts:SetSourceIdentity."
          />
        ) : null}
      </div>

      <TrustPolicyBlock label="Trust policy" policy={buildTrustPolicy(data)} />

      {data.sessionPolicyArns.length > 0 ? (
        <p className="text-xs leading-normal text-muted-foreground">
          Sessions are capped at{' '}
          <code className="font-mono">{data.sessionPolicyArns.join(', ')}</code>
          , so Roadie cannot write to your account even if the role permits it.
        </p>
      ) : null}
    </div>
  );
}
