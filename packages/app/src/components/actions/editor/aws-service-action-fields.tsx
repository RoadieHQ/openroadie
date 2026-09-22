import { useMemo } from 'react';
import { Combobox } from '@roadiehq/ui/combobox';
import {
  getAwsOperationMetadata,
  getAwsServiceMetadata,
  listAwsServices,
} from '@roadiehq/types';
import type { AwsServiceActionRequest } from '@roadiehq/actions-common';
import {
  getAwsOrganizationsConfig,
  getAwsProfiles,
} from '../../integrations/aws-config';
import type { Integration } from '../../integrations/types';

const AWS_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'af-south-1',
  'ap-east-1',
  'ap-south-1',
  'ap-south-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ap-southeast-4',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ca-central-1',
  'eu-central-1',
  'eu-central-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-south-1',
  'eu-south-2',
  'eu-north-1',
  'il-central-1',
  'me-south-1',
  'me-central-1',
  'sa-east-1',
];

export function makeAwsServiceActionRequest(
  integration: Integration,
): AwsServiceActionRequest {
  const profiles = getAwsProfiles(integration.config);
  const organizations = getAwsOrganizationsConfig(integration.config);
  const profile = profiles[0];
  return {
    backendType: 'aws',
    mode: 'service-api',
    service: '',
    operation: '',
    profile: profile?.accountId ?? organizations?.managementAccountId ?? '',
    region:
      profile?.region ??
      organizations?.defaultRegion ??
      organizations?.managementRegion ??
      'us-east-1',
    method: 'POST',
    path: '/',
    headers: [],
    body: '',
  };
}

export function updateAwsOperationRequest(
  request: AwsServiceActionRequest,
  operation: string,
): AwsServiceActionRequest {
  const metadata = getAwsOperationMetadata(request.service, operation);
  const previousMetadata = getAwsOperationMetadata(
    request.service,
    request.operation,
  );
  return {
    ...request,
    operation: metadata?.operation ?? operation,
    ...(metadata
      ? {
          method: metadata.method,
          path: metadata.path,
          headers: Object.entries(metadata.headers ?? {}).map(
            ([key, value]) => ({ key, value }),
          ),
          body: metadata.body ?? '',
        }
      : previousMetadata
        ? {
            method: 'POST',
            path: '/',
            headers: [],
            body: '',
          }
        : {}),
  };
}

export function AwsServiceActionFields({
  integration,
  request,
  disabled,
  onChange,
}: {
  integration: Integration;
  request: AwsServiceActionRequest;
  disabled?: boolean;
  onChange: (request: AwsServiceActionRequest) => void;
}) {
  const profiles = useMemo(
    () => getAwsProfiles(integration.config),
    [integration.config],
  );
  const accountOptions = useMemo(
    () =>
      profiles.map(profile => ({
        value: profile.accountId,
        description: profile.name,
      })),
    [profiles],
  );
  const operationOptions = useMemo(
    () =>
      getAwsServiceMetadata(request.service)?.operations.map(operation => ({
        value: operation.operation,
        description: operation.label,
      })) ?? [],
    [request.service],
  );

  const handleServiceChange = (service: string) => {
    onChange({
      ...request,
      service,
      operation: '',
      method: 'POST',
      path: '/',
      headers: [],
      body: '',
    });
  };

  const handleOperationChange = (operation: string) => {
    onChange(updateAwsOperationRequest(request, operation));
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Combobox
        label="AWS account"
        value={request.profile}
        onChange={profile => {
          const selected = profiles.find(item => item.accountId === profile);
          onChange({
            ...request,
            profile,
            region: selected?.region ?? request.region,
          });
        }}
        options={accountOptions}
        placeholder="123456789012"
        disabled={disabled}
      />
      <Combobox
        label="Region"
        value={request.region}
        onChange={region => onChange({ ...request, region })}
        options={AWS_REGIONS.map(value => ({ value }))}
        placeholder="us-east-1"
        disabled={disabled}
      />
      <Combobox
        label="AWS service"
        value={request.service}
        onChange={handleServiceChange}
        options={listAwsServices().map(service => ({
          value: service.service,
          description: service.label,
        }))}
        placeholder="Select a service"
        disabled={disabled}
      />
      <Combobox
        label="Operation"
        value={request.operation ?? ''}
        onChange={handleOperationChange}
        options={operationOptions}
        placeholder="Select or enter an operation"
        disabled={disabled}
      />
    </div>
  );
}
