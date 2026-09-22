import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { InlineCode } from '@roadiehq/ui/inline-code';
import { OutlinedTextarea } from '@roadiehq/ui/outlined-textarea';
import { Combobox } from '@roadiehq/ui/combobox';
import { MultiCombobox } from '@roadiehq/ui/multi-combobox';
import { AdvancedSection } from '@roadiehq/ui/advanced-section';
import { ToggleGroup } from '@roadiehq/ui/toggle-group';
import { Button } from '@roadiehq/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import {
  getAwsOperationMetadata,
  getAwsServiceMetadata,
  listAwsServices,
} from '@roadiehq/types';
import {
  formatInvalidAwsAccountIdsMessage,
  getAwsOrganizationsConfig,
  getAwsProfiles,
  getInvalidAwsAccountIds,
  isAwsAccountIdValue,
} from '../../../integrations/aws-config';
import type { Integration } from '../../../integrations/types';
import type { AwsOrganizationAccountPreview } from '../../../../api/workflow/workflow-client';
import { workspaceQueryKey } from '../../../../api/workspace-scope';
import type {
  AwsAccountSelectionConfig,
  AwsIntegrationSourceConfig,
  Header,
  PaginationConfig,
} from '../data-source-editor-context';
import { PaginationSettings } from './pagination-settings';
import { getResourceModelJsonError } from './resource-model-json';
import { HeadersEditor } from '../../../common/request-editor';

function formatAwsAccountLabel(profile: {
  name?: string;
  accountId: string;
}): string {
  return profile.name?.trim()
    ? `${profile.name.trim()} (${profile.accountId})`
    : profile.accountId;
}

function matchesRequiredTags(
  tags: Record<string, string> | undefined,
  requiredTags: Header[] | undefined,
): boolean {
  const filters = (requiredTags ?? []).filter(
    entry => entry.key.trim() && entry.value.trim(),
  );

  if (filters.length === 0) {
    return true;
  }

  return filters.every(entry => tags?.[entry.key] === entry.value);
}

function matchesExcludedTags(
  tags: Record<string, string> | undefined,
  excludedTags: Header[] | undefined,
): boolean {
  const filters = (excludedTags ?? []).filter(
    entry => entry.key.trim() && entry.value.trim(),
  );

  if (filters.length === 0) {
    return false;
  }

  return filters.some(entry => tags?.[entry.key] === entry.value);
}

function filterDynamicAccounts(
  accounts: AwsOrganizationAccountPreview[],
  selection: AwsAccountSelectionConfig | undefined,
): AwsOrganizationAccountPreview[] {
  if (selection?.mode !== 'all') {
    return accounts;
  }

  const excludedIds = new Set(selection.excludedAccountIds ?? []);

  return accounts.filter(account => {
    if (excludedIds.has(account.accountId)) {
      return false;
    }

    if (!matchesRequiredTags(account.tags, selection.requiredTags)) {
      return false;
    }

    if (matchesExcludedTags(account.tags, selection.excludedTags)) {
      return false;
    }

    return true;
  });
}

interface AwsSourceConfigProps {
  config: AwsIntegrationSourceConfig;
  onChange: (key: string, value: unknown) => void;
  integration?: Integration | null;
  allowAccountTemplates?: boolean;
  loadOrganizationAccounts?: () => Promise<AwsOrganizationAccountPreview[]>;
  /**
   * The selected integration id `loadOrganizationAccounts` closes over. Keying
   * the org-accounts query on this (rather than `integration?.id`) matches the
   * fetch's actual input exactly, so the cache can never key a fetch's result
   * under a different id.
   */
  selectedIntegrationId?: string;
}

const COMMON_RESOURCE_TYPES = [
  'AWS::ACM::Certificate',
  'AWS::ApiGateway::RestApi',
  'AWS::ApiGateway::Stage',
  'AWS::ApiGatewayV2::Api',
  'AWS::AppSync::GraphQLApi',
  'AWS::Athena::WorkGroup',
  'AWS::AutoScaling::AutoScalingGroup',
  'AWS::AutoScaling::LaunchConfiguration',
  'AWS::Batch::ComputeEnvironment',
  'AWS::Batch::JobQueue',
  'AWS::CloudFormation::Stack',
  'AWS::CloudFront::Distribution',
  'AWS::CloudTrail::Trail',
  'AWS::CloudWatch::Alarm',
  'AWS::CloudWatch::MetricStream',
  'AWS::CodeBuild::Project',
  'AWS::CodeCommit::Repository',
  'AWS::CodeDeploy::Application',
  'AWS::CodePipeline::Pipeline',
  'AWS::Cognito::UserPool',
  'AWS::Cognito::UserPoolClient',
  'AWS::DAX::Cluster',
  'AWS::DMS::ReplicationInstance',
  'AWS::DynamoDB::Table',
  'AWS::EC2::CustomerGateway',
  'AWS::EC2::DHCPOptions',
  'AWS::EC2::EIP',
  'AWS::EC2::FlowLog',
  'AWS::EC2::Instance',
  'AWS::EC2::InternetGateway',
  'AWS::EC2::LaunchTemplate',
  'AWS::EC2::NatGateway',
  'AWS::EC2::NetworkAcl',
  'AWS::EC2::NetworkInterface',
  'AWS::EC2::RouteTable',
  'AWS::EC2::SecurityGroup',
  'AWS::EC2::Subnet',
  'AWS::EC2::TransitGateway',
  'AWS::EC2::VPC',
  'AWS::EC2::VPCEndpoint',
  'AWS::EC2::VPNConnection',
  'AWS::EC2::VPNGateway',
  'AWS::EC2::Volume',
  'AWS::ECR::PublicRepository',
  'AWS::ECR::Repository',
  'AWS::ECS::Cluster',
  'AWS::ECS::Service',
  'AWS::ECS::TaskDefinition',
  'AWS::EFS::FileSystem',
  'AWS::EKS::Cluster',
  'AWS::EKS::Nodegroup',
  'AWS::EMR::Cluster',
  'AWS::ElastiCache::CacheCluster',
  'AWS::ElastiCache::ReplicationGroup',
  'AWS::ElasticBeanstalk::Application',
  'AWS::ElasticBeanstalk::Environment',
  'AWS::ElasticLoadBalancing::LoadBalancer',
  'AWS::ElasticLoadBalancingV2::LoadBalancer',
  'AWS::ElasticLoadBalancingV2::TargetGroup',
  'AWS::Elasticsearch::Domain',
  'AWS::Events::EventBus',
  'AWS::Events::Rule',
  'AWS::Glue::Crawler',
  'AWS::Glue::Database',
  'AWS::Glue::Job',
  'AWS::GuardDuty::Detector',
  'AWS::IAM::Group',
  'AWS::IAM::InstanceProfile',
  'AWS::IAM::Policy',
  'AWS::IAM::Role',
  'AWS::IAM::User',
  'AWS::IdentityStore::Group',
  'AWS::IdentityStore::GroupMembership',
  'AWS::KMS::Key',
  'AWS::Kinesis::Stream',
  'AWS::KinesisFirehose::DeliveryStream',
  'AWS::Lambda::Function',
  'AWS::Lambda::LayerVersion',
  'AWS::Logs::LogGroup',
  'AWS::MSK::Cluster',
  'AWS::Neptune::DBCluster',
  'AWS::Neptune::DBInstance',
  'AWS::OpenSearchService::Domain',
  'AWS::Organizations::Account',
  'AWS::Organizations::Organization',
  'AWS::Organizations::OrganizationalUnit',
  'AWS::Organizations::Policy',
  'AWS::Organizations::ResourcePolicy',
  'AWS::RDS::DBCluster',
  'AWS::RDS::DBInstance',
  'AWS::RDS::DBSubnetGroup',
  'AWS::Redshift::Cluster',
  'AWS::Route53::HostedZone',
  'AWS::S3::Bucket',
  'AWS::SNS::Subscription',
  'AWS::SNS::Topic',
  'AWS::SQS::Queue',
  'AWS::SSM::Parameter',
  'AWS::SSO::Application',
  'AWS::SSO::ApplicationAssignment',
  'AWS::SSO::Assignment',
  'AWS::SSO::Instance',
  'AWS::SSO::InstanceAccessControlAttributeConfiguration',
  'AWS::SSO::PermissionSet',
  'AWS::SageMaker::Endpoint',
  'AWS::SageMaker::NotebookInstance',
  'AWS::SecretsManager::Secret',
  'AWS::ServiceDiscovery::Service',
  'AWS::StepFunctions::StateMachine',
  'AWS::WAFv2::WebACL',
];

const RESOURCE_TYPE_OPTIONS = COMMON_RESOURCE_TYPES.map(type => ({
  value: type,
}));

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

const REGION_OPTIONS = AWS_REGIONS.map(region => ({ value: region }));

interface AwsRegionsFieldProps {
  selectedRegions: string[];
  defaultRegion: string;
  onChange: (regions: string[]) => void;
  description: React.ReactNode;
}

function AwsRegionsField({
  selectedRegions,
  defaultRegion,
  onChange,
  description,
}: AwsRegionsFieldProps) {
  return (
    <div>
      <MultiCombobox
        label="Regions"
        values={selectedRegions}
        onChange={onChange}
        options={REGION_OPTIONS}
        placeholder={`Default: ${defaultRegion}`}
      />
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

// Stable empty reference so `availableAccounts` doesn't recompute while the
// org-accounts query is idle/unresolved.
const EMPTY_ORG_ACCOUNTS: AwsOrganizationAccountPreview[] = [];

export function AwsSourceConfig({
  config,
  onChange,
  integration,
  allowAccountTemplates = false,
  loadOrganizationAccounts,
  selectedIntegrationId,
}: AwsSourceConfigProps) {
  const [showAllPreviewAccounts, setShowAllPreviewAccounts] = useState(false);
  const mode = config.mode === 'service-api' ? 'service-api' : 'cloud-control';
  const selectionMode =
    config.accountSelection?.mode === 'all' ? 'all' : 'explicit';
  const profiles = useMemo(
    () => getAwsProfiles(integration?.config),
    [integration],
  );
  const organizationsConfig = useMemo(
    () => getAwsOrganizationsConfig(integration?.config),
    [integration],
  );
  const organizationsEnabled = Boolean(
    organizationsConfig?.enabled && loadOrganizationAccounts,
  );
  const orgAccountsQuery = useQuery({
    queryKey: workspaceQueryKey(
      'integrations',
      'awsOrgAccounts',
      selectedIntegrationId ?? integration?.id ?? '',
    ),
    queryFn: () =>
      loadOrganizationAccounts
        ? loadOrganizationAccounts()
        : Promise.resolve<AwsOrganizationAccountPreview[]>([]),
    enabled: organizationsEnabled,
  });
  const previewAccounts = orgAccountsQuery.data ?? EMPTY_ORG_ACCOUNTS;
  const previewLoading = organizationsEnabled && orgAccountsQuery.isLoading;
  const previewError = orgAccountsQuery.error
    ? orgAccountsQuery.error instanceof Error
      ? orgAccountsQuery.error.message
      : 'Failed to load AWS organization accounts'
    : null;

  const availableAccounts = useMemo<AwsOrganizationAccountPreview[]>(() => {
    const manualAccounts = profiles.map(profile => ({
      accountId: profile.accountId,
      name: profile.name,
      roleName: profile.roleName,
      externalId: profile.externalId,
      region: profile.region,
      isManagementAccount: false,
      source: 'manual' as const,
    }));
    const byAccountId = new Map(
      previewAccounts.map(account => [account.accountId, account]),
    );

    for (const account of manualAccounts) {
      byAccountId.set(account.accountId, account);
    }

    return [...byAccountId.values()];
  }, [previewAccounts, profiles]);

  const availableAccountById = useMemo(
    () =>
      new Map(availableAccounts.map(account => [account.accountId, account])),
    [availableAccounts],
  );
  const filteredDynamicAccounts = useMemo(
    () => filterDynamicAccounts(availableAccounts, config.accountSelection),
    [config.accountSelection, availableAccounts],
  );
  const hasConfiguredProfiles = profiles.length > 0;
  const showAccountSelectionToggle =
    organizationsEnabled || hasConfiguredProfiles;
  const hasQueryableAccountOptions = availableAccounts.length > 0;
  const queryAccountOptions = useMemo(
    () =>
      availableAccounts.map(account => ({
        value: account.accountId,
        label: formatAwsAccountLabel(account),
      })),
    [availableAccounts],
  );
  const services = listAwsServices();
  const selectedService =
    typeof config.service === 'string' ? config.service : '';
  const selectedHeaders = useMemo<Header[]>(() => {
    if (Array.isArray(config.headers)) {
      return config.headers as Header[];
    }
    if (config.headers && typeof config.headers === 'object') {
      return Object.entries(config.headers as Record<string, string>).map(
        ([key, value]) => ({
          key,
          value,
        }),
      );
    }
    return [];
  }, [config.headers]);

  const selectedAccountIds = useMemo(
    () => (selectionMode === 'explicit' ? (config.accountIds ?? []) : []),
    [config.accountIds, selectionMode],
  );
  const defaultRegionForSelection = useMemo(() => {
    const regionSourceAccounts =
      selectionMode === 'all'
        ? filteredDynamicAccounts
        : selectedAccountIds
            .map(id => availableAccountById.get(id))
            .filter((account): account is AwsOrganizationAccountPreview =>
              Boolean(account),
            );
    const regions = regionSourceAccounts
      .map(account => account.region)
      .filter((r): r is string => Boolean(r));
    const unique = Array.from(new Set(regions));
    if (unique.length === 1) {
      return unique[0];
    }

    return organizationsConfig?.defaultRegion ?? 'us-east-1';
  }, [
    availableAccountById,
    filteredDynamicAccounts,
    organizationsConfig?.defaultRegion,
    selectedAccountIds,
    selectionMode,
  ]);
  const [cloudControlAdvancedOpen, setCloudControlAdvancedOpen] =
    useState(false);
  const [excludedAccountIdsInputError, setExcludedAccountIdsInputError] =
    useState<string | undefined>();
  const [accountIdsInputError, setAccountIdsInputError] = useState<
    string | undefined
  >();

  const accountIdValidationOptions = useMemo(
    () => ({ allowTemplates: allowAccountTemplates }),
    [allowAccountTemplates],
  );

  const unresolvedAccountIds = useMemo(
    () =>
      selectedAccountIds.filter(
        accountId => !availableAccountById.has(accountId),
      ),
    [availableAccountById, selectedAccountIds],
  );
  const hasRoleNameOverride =
    typeof config.roleName === 'string' && config.roleName.trim().length > 0;
  const requiresAuthOverride =
    !allowAccountTemplates &&
    mode === 'cloud-control' &&
    selectionMode === 'explicit' &&
    unresolvedAccountIds.length > 0 &&
    !hasRoleNameOverride;
  const hasUnsupportedServiceApiAccounts =
    !allowAccountTemplates &&
    mode === 'service-api' &&
    selectionMode === 'explicit' &&
    unresolvedAccountIds.length > 0;

  useEffect(() => {
    if (requiresAuthOverride) {
      setCloudControlAdvancedOpen(true);
    }
  }, [requiresAuthOverride]);

  const operationOptions = useMemo(() => {
    return (
      getAwsServiceMetadata(selectedService)?.operations.map(operation => ({
        value: operation.operation,
        description: operation.label,
      })) ?? []
    );
  }, [selectedService]);

  const selectedOperationName =
    typeof config.operation === 'string' ? config.operation : '';
  const protocolOperationMetadata = useMemo(
    () => getAwsOperationMetadata(selectedService, selectedOperationName),
    [selectedService, selectedOperationName],
  );

  const applyOperationDefaults = useCallback(
    (service: string, operation: string) => {
      const metadata = getAwsOperationMetadata(service, operation);
      if (!metadata) {
        return;
      }
      onChange('operation', metadata.operation);
      onChange('method', metadata.method);
      onChange('path', metadata.path);
      onChange(
        'headers',
        Object.entries(metadata.headers ?? {}).map(([key, value]) => ({
          key,
          value,
        })),
      );
      onChange('body', metadata.body);
      onChange('arrayExpression', metadata.arrayExpression);
      onChange('objectIdExpression', metadata.objectIdExpression);
      onChange('pagination', metadata.pagination ?? { type: 'none' });
    },
    [onChange],
  );

  const handleServiceChange = useCallback(
    (value: string) => {
      onChange('service', value);
      onChange('operation', '');
      const service = getAwsServiceMetadata(value);
      if (service?.operations.length === 1) {
        applyOperationDefaults(value, service.operations[0].operation);
      }
    },
    [applyOperationDefaults, onChange],
  );

  const handleOperationChange = useCallback(
    (value: string) => {
      applyOperationDefaults(selectedService, value);
    },
    [applyOperationDefaults, selectedService],
  );

  const handleHeadersChange = useCallback(
    (headers: Header[]) => {
      onChange('headers', headers);
    },
    [onChange],
  );

  const handlePaginationChange = useCallback(
    (pagination: PaginationConfig) => {
      onChange('pagination', pagination);
    },
    [onChange],
  );

  const handleSelectionModeChange = useCallback(
    (value: 'explicit' | 'all') => {
      setExcludedAccountIdsInputError(undefined);
      setAccountIdsInputError(undefined);

      if (value === 'all') {
        onChange('accountIds', undefined);
        onChange('accountSelection', {
          mode: 'all',
          excludedAccountIds: [],
          requiredTags: [],
          excludedTags: [],
        });
        return;
      }

      onChange('accountSelection', undefined);
      onChange('accountIds', config.accountIds ?? []);
    },
    [config.accountIds, onChange],
  );

  const updateAccountSelection = useCallback(
    (updates: Partial<AwsAccountSelectionConfig>) => {
      const currentSelection =
        config.accountSelection?.mode === 'all'
          ? config.accountSelection
          : {
              mode: 'all' as const,
              excludedAccountIds: [],
              requiredTags: [],
              excludedTags: [],
            };

      onChange('accountSelection', {
        ...currentSelection,
        ...updates,
      });
    },
    [config.accountSelection, onChange],
  );

  const handleExcludedAccountIdsChange = useCallback(
    (nextIds: string[]) => {
      const previousIds = config.accountSelection?.excludedAccountIds ?? [];
      const accepted = nextIds
        .map(id => id.trim())
        .filter(
          (id, index, allIds) =>
            id.length > 0 &&
            allIds.indexOf(id) === index &&
            isAwsAccountIdValue(id, accountIdValidationOptions),
        );
      const rejected = nextIds
        .map(id => id.trim())
        .filter(
          id =>
            id.length > 0 &&
            !isAwsAccountIdValue(id, accountIdValidationOptions) &&
            !previousIds.includes(id),
        );

      setExcludedAccountIdsInputError(
        formatInvalidAwsAccountIdsMessage(rejected),
      );
      updateAccountSelection({
        excludedAccountIds: accepted,
      });
    },
    [
      accountIdValidationOptions,
      config.accountSelection?.excludedAccountIds,
      updateAccountSelection,
    ],
  );

  const handleAccountIdsChange = useCallback(
    (nextIds: string[]) => {
      const accepted = nextIds
        .map(id => id.trim())
        .filter(
          (id, index, allIds) =>
            id.length > 0 &&
            allIds.indexOf(id) === index &&
            isAwsAccountIdValue(id, accountIdValidationOptions),
        );
      const rejected = nextIds
        .map(id => id.trim())
        .filter(
          id =>
            id.length > 0 &&
            !isAwsAccountIdValue(id, accountIdValidationOptions) &&
            !selectedAccountIds.includes(id),
        );

      setAccountIdsInputError(formatInvalidAwsAccountIdsMessage(rejected));
      onChange('accountIds', accepted);
    },
    [accountIdValidationOptions, onChange, selectedAccountIds],
  );

  const excludedAccountIdsValidationMessage = useMemo(() => {
    const persistedInvalid = getInvalidAwsAccountIds(
      config.accountSelection?.excludedAccountIds ?? [],
      accountIdValidationOptions,
    );
    return (
      excludedAccountIdsInputError ??
      formatInvalidAwsAccountIdsMessage(persistedInvalid)
    );
  }, [
    accountIdValidationOptions,
    config.accountSelection?.excludedAccountIds,
    excludedAccountIdsInputError,
  ]);

  const accountIdsValidationMessage = useMemo(() => {
    const persistedInvalid = getInvalidAwsAccountIds(
      selectedAccountIds,
      accountIdValidationOptions,
    );
    return (
      accountIdsInputError ??
      formatInvalidAwsAccountIdsMessage(persistedInvalid)
    );
  }, [accountIdValidationOptions, accountIdsInputError, selectedAccountIds]);
  const previewAccountsToRender = useMemo(
    () =>
      showAllPreviewAccounts
        ? filteredDynamicAccounts
        : filteredDynamicAccounts.slice(0, 3),
    [filteredDynamicAccounts, showAllPreviewAccounts],
  );

  const selectedRegions = config.regions ?? [];
  const resourceModelJsonError = useMemo(
    () => getResourceModelJsonError(config.resourceModel),
    [config.resourceModel],
  );
  const accountValidationMessage = requiresAuthOverride
    ? 'Custom account IDs require a Role Name under Authentication Override.'
    : hasUnsupportedServiceApiAccounts
      ? 'Service API sources can only use configured AWS accounts from the integration.'
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      {config.mode === 'configured-accounts' ? (
        <p className="text-sm leading-normal text-muted-foreground">
          This source lists AWS accounts from the integration: manually
          configured profiles and, when enabled, Organizations accounts.
        </p>
      ) : null}
      {config.mode !== 'configured-accounts' && showAccountSelectionToggle ? (
        <div className="rounded-lg border border-divider p-3">
          <div className="space-y-4">
            <div className="space-y-1">
              <h4 className="text-sm font-medium">Account Selection</h4>
              <p className="text-xs leading-normal text-muted-foreground">
                Choose specific accounts or store a live select-all rule that is
                resolved again each time the source runs.
              </p>
            </div>
            <ToggleGroup
              value={selectionMode}
              onValueChange={handleSelectionModeChange}
              items={[
                {
                  value: 'explicit' as const,
                  label: 'Specific accounts',
                },
                {
                  value: 'all' as const,
                  label: 'Select all accounts',
                },
              ]}
              aria-label="AWS account selection mode"
              size="lg"
              className="motion-nested-button-colors inline-flex w-fit rounded-lg border border-border bg-card p-1 shadow-sm [&_button]:rounded-md [&_button]:border-0 [&_button]:px-3.5 [&_button]:text-sm [&_button]:font-medium [&_button]:text-foreground/60 [&_button:hover]:text-foreground [&_button[aria-checked=true]]:bg-primary/10 [&_button[aria-checked=true]]:font-semibold [&_button[aria-checked=true]]:text-primary dark:[&_button[aria-checked=true]]:bg-primary/20 dark:[&_button[aria-checked=true]]:text-primary"
            />
            {selectionMode === 'all' ? (
              <>
                <div className="space-y-1 border-t border-divider pt-4">
                  <h4 className="text-sm font-medium">Live Preview</h4>
                  {previewLoading ? (
                    <p className="text-xs leading-normal text-muted-foreground">
                      Loading live organization accounts...
                    </p>
                  ) : previewError ? (
                    <p className="text-xs leading-normal text-destructive">
                      {previewError}
                    </p>
                  ) : (
                    <>
                      <p className="text-sm">
                        {filteredDynamicAccounts.length}{' '}
                        {filteredDynamicAccounts.length === 1
                          ? 'matching account'
                          : 'matching accounts'}
                      </p>
                      {filteredDynamicAccounts.length > 0 ? (
                        <TooltipProvider delayDuration={250}>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {previewAccountsToRender.map(account => {
                              const label = formatAwsAccountLabel(account);
                              return (
                                <Tooltip key={account.accountId}>
                                  <TooltipTrigger asChild>
                                    <div className="inline-flex max-w-full items-center rounded-full border border-divider bg-muted/20 px-2 py-1 font-mono text-xs text-foreground">
                                      <span className="block max-w-[280px] truncate">
                                        {label}
                                      </span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>{label}</TooltipContent>
                                </Tooltip>
                              );
                            })}
                            {filteredDynamicAccounts.length > 3 ? (
                              <Button
                                type="button"
                                variant="link"
                                className="h-auto p-0 text-xs"
                                onClick={() =>
                                  setShowAllPreviewAccounts(prev => !prev)
                                }
                              >
                                {showAllPreviewAccounts
                                  ? 'Show fewer accounts'
                                  : `Show all ${filteredDynamicAccounts.length} accounts`}
                              </Button>
                            ) : null}
                          </div>
                        </TooltipProvider>
                      ) : null}
                    </>
                  )}
                </div>

                <AdvancedSection
                  label="Exclusions & filtering"
                  variant="embedded"
                >
                  <div>
                    <MultiCombobox
                      label="Excluded Accounts"
                      values={config.accountSelection?.excludedAccountIds ?? []}
                      onChange={handleExcludedAccountIdsChange}
                      options={availableAccounts.map(account => ({
                        value: account.accountId,
                        label: formatAwsAccountLabel(account),
                      }))}
                      placeholder={
                        availableAccounts.length > 0
                          ? 'Select or type an account ID, then use space or comma'
                          : 'Type an account ID, then use space or comma'
                      }
                      allowCustomValues
                      customValueSplitPattern={/[\s,]+/}
                      renderChipLabel={value =>
                        formatAwsAccountLabel(
                          availableAccountById.get(value) ?? {
                            accountId: value,
                          },
                        )
                      }
                    />
                    <p className="mt-1 text-xs leading-normal text-muted-foreground">
                      Choose from live preview accounts or type IDs manually.
                      Separate IDs with a space or comma to create chips.
                    </p>
                    {excludedAccountIdsValidationMessage ? (
                      <p className="mt-2 text-xs text-destructive">
                        {excludedAccountIdsValidationMessage}
                      </p>
                    ) : null}
                  </div>

                  <HeadersEditor
                    headers={config.accountSelection?.requiredTags}
                    onChange={headers =>
                      updateAccountSelection({
                        requiredTags: headers,
                      })
                    }
                    title="Required Tags"
                    topAddLabel="Add required tag"
                    emptyState={
                      <p className="text-xs leading-normal text-muted-foreground">
                        Matching accounts must include every required tag.
                      </p>
                    }
                    nameLabel="Tag Key"
                    namePlaceholder="Environment"
                    valueLabel="Tag Value"
                    valuePlaceholder="prod"
                    rowKey={(header, index) => `${header.key}-${index}`}
                    removeButtonClassName="shrink-0"
                  />

                  <HeadersEditor
                    headers={config.accountSelection?.excludedTags}
                    onChange={headers =>
                      updateAccountSelection({
                        excludedTags: headers,
                      })
                    }
                    title="Excluded Tags"
                    topAddLabel="Add excluded tag"
                    emptyState={
                      <p className="text-xs leading-normal text-muted-foreground">
                        Accounts matching any excluded tag are filtered out.
                      </p>
                    }
                    nameLabel="Tag Key"
                    namePlaceholder="Environment"
                    valueLabel="Tag Value"
                    valuePlaceholder="sandbox"
                    rowKey={(header, index) => `${header.key}-${index}`}
                    removeButtonClassName="shrink-0"
                  />
                </AdvancedSection>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {config.mode !== 'configured-accounts' && selectionMode === 'explicit' ? (
        <div>
          <MultiCombobox
            label="Accounts to query"
            values={selectedAccountIds}
            onChange={handleAccountIdsChange}
            options={queryAccountOptions}
            placeholder={
              hasQueryableAccountOptions
                ? 'Select or type an account ID, then use space or comma'
                : 'Type an account ID, then use space or comma'
            }
            allowCustomValues
            customValueSplitPattern={/[\s,]+/}
            renderChipLabel={value =>
              formatAwsAccountLabel(
                availableAccountById.get(value) ?? { accountId: value },
              )
            }
          />
          <p className="mt-1 text-xs leading-normal text-muted-foreground">
            {hasQueryableAccountOptions
              ? organizationsEnabled
                ? 'Choose configured integration accounts, live organization accounts, or type IDs manually. Separate IDs with a space or comma to create chips.'
                : 'Choose configured integration accounts or type IDs manually. Separate IDs with a space or comma to create chips.'
              : 'Type account IDs manually. Separate IDs with a space or comma to create chips.'}
            {allowAccountTemplates
              ? ' Template expressions are also supported.'
              : null}
          </p>
          {accountIdsValidationMessage ? (
            <p className="mt-2 text-xs text-destructive">
              {accountIdsValidationMessage}
            </p>
          ) : null}
          {accountValidationMessage ? (
            <p className="mt-2 text-xs text-destructive">
              {accountValidationMessage}
            </p>
          ) : null}
          {organizationsEnabled ? (
            previewLoading ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Loading live organization accounts...
              </p>
            ) : previewError ? (
              <p className="mt-2 text-xs text-destructive">{previewError}</p>
            ) : null
          ) : null}
        </div>
      ) : null}
      {config.mode !== 'configured-accounts' && mode === 'cloud-control' ? (
        <>
          <div>
            <Combobox
              label="Resource Type"
              value={config.resourceType || ''}
              onChange={value => onChange('resourceType', value)}
              options={RESOURCE_TYPE_OPTIONS}
              placeholder="Select or type a resource type"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              AWS Cloud Control API resource type (e.g. AWS::S3::Bucket). Only{' '}
              <a
                href="https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline hover:text-primary/80"
              >
                resources with List support
              </a>{' '}
              can be fetched.
            </p>
          </div>

          <AdvancedSection
            open={requiresAuthOverride ? true : cloudControlAdvancedOpen}
            onOpenChange={setCloudControlAdvancedOpen}
          >
            <AwsRegionsField
              selectedRegions={selectedRegions}
              defaultRegion={defaultRegionForSelection}
              onChange={regions => onChange('regions', regions)}
              description={
                <>
                  Regions where Cloud Control runs ListResources and GetResource
                  for each account. Leave empty to query only{' '}
                  <InlineCode>{defaultRegionForSelection}</InlineCode>{' '}
                  (per-account default). Select regions to scan additional
                  Regions.
                </>
              }
            />

            <div>
              <h4 className="mb-2 text-sm font-medium">Filter</h4>
              <OutlinedInput
                label="JSON"
                value={config.resourceModel || ''}
                onChange={e => onChange('resourceModel', e.target.value)}
                placeholder='e.g. {"Tags": [{"Key": "Environment", "Value": "prod"}]}'
                aria-invalid={Boolean(resourceModelJsonError)}
                className={
                  resourceModelJsonError
                    ? 'border-destructive hover:border-destructive focus-visible:border-destructive focus-visible:ring-destructive'
                    : undefined
                }
                labelClassName={
                  resourceModelJsonError ? 'text-destructive' : undefined
                }
              />
              {resourceModelJsonError ? (
                <p className="mt-1 text-xs text-destructive">
                  {resourceModelJsonError}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Optional JSON passed only to the Cloud Control{' '}
                  <InlineCode>ListResources</InlineCode> call (
                  <a
                    href="https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/resource-operations-list.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline hover:text-primary/80"
                  >
                    ResourceModel
                  </a>
                  ). Example:{' '}
                  <InlineCode>
                    {'{"Tags": [{"Key": "Environment", "Value": "prod"}]}'}
                  </InlineCode>
                </p>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-sm font-medium">
                Authentication Override
              </h4>
              <p className="mb-2 text-xs text-muted-foreground">
                Authentication override applies to every account under Accounts
                to query for this source, not only accounts you type in
                manually. For each of those accounts, Role Name and External ID
                here replace the values from that account&apos;s profile in the
                AWS integration for Cloud Control calls (templates supported).
                Use this when the whole source must assume a different role than
                the profiles, or when you need a role for an account that has no
                profile yet.
              </p>
              <p className="mb-2 text-xs text-muted-foreground">
                This is also useful when your integration&apos;s default roles
                cannot access the resources this source needs: set a dedicated,
                more tightly scoped role here for this data source only, rather
                than widening the account&apos;s default role in the integration
                so every other use of that account inherits broader permissions.
              </p>
              <p className="mb-4 text-xs text-muted-foreground">
                Auth Region is where STS performs assume-role for every account
                in this source. Leave it blank to use the same Region as each
                Cloud Control request (the Regions above, or{' '}
                <InlineCode>{defaultRegionForSelection}</InlineCode> when none
                are selected).
              </p>
              <div className="flex flex-col gap-4">
                <div>
                  <OutlinedInput
                    label="Role Name"
                    value={config.roleName || ''}
                    onChange={e => onChange('roleName', e.target.value)}
                    placeholder="MyAssumeRole or arn:aws:iam::123456789:role/MyRole"
                    aria-invalid={requiresAuthOverride}
                    className={
                      requiresAuthOverride
                        ? 'border-destructive hover:border-destructive focus-visible:border-destructive focus-visible:ring-destructive'
                        : undefined
                    }
                    labelClassName={
                      requiresAuthOverride ? 'text-destructive' : undefined
                    }
                  />
                  {requiresAuthOverride ? (
                    <p className="mt-1 text-xs text-destructive">
                      Enter a role name or ARN. It will be used for every
                      account selected for this source, including any you typed
                      in that are not in the integration.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      IAM role name or ARN to assume (supports templates like{' '}
                      {'{{roleName}}'})
                    </p>
                  )}
                </div>
                <div>
                  <OutlinedInput
                    label="External ID"
                    value={config.externalId || ''}
                    onChange={e => onChange('externalId', e.target.value)}
                    placeholder="external-id-value"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    External ID for role assumption (supports templates)
                  </p>
                </div>
                <div>
                  <Combobox
                    label="Auth Region"
                    value={config.authRegion || ''}
                    onChange={value => onChange('authRegion', value)}
                    options={AWS_REGIONS.map(r => ({ value: r }))}
                    placeholder={defaultRegionForSelection}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Region for STS authentication (supports templates)
                  </p>
                </div>
              </div>
            </div>
          </AdvancedSection>
        </>
      ) : config.mode !== 'configured-accounts' ? (
        <>
          <div>
            <Combobox
              label="AWS Service"
              value={selectedService}
              onChange={handleServiceChange}
              options={services.map(service => ({
                value: service.service,
                description: service.label,
              }))}
              placeholder="Select a service"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Select a service from the checked-in AWS operation metadata
            </p>
          </div>

          <div>
            <Combobox
              label="Operation"
              value={
                typeof config.operation === 'string' ? config.operation : ''
              }
              onChange={handleOperationChange}
              options={operationOptions}
              placeholder="Select an operation"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Selecting an operation fills in request and pagination defaults
            </p>
          </div>

          <AdvancedSection>
            <div className="flex flex-col gap-4">
              <AwsRegionsField
                selectedRegions={selectedRegions}
                defaultRegion={defaultRegionForSelection}
                onChange={regions => onChange('regions', regions)}
                description={
                  <>
                    Regions for the target service endpoint. Leave empty to
                    query only{' '}
                    <InlineCode>{defaultRegionForSelection}</InlineCode>{' '}
                    (per-account default). Select regions to scan additional
                    Regions.
                  </>
                }
              />

              <div className="grid gap-4 md:grid-cols-2">
                <Combobox
                  label="HTTP Method"
                  value={config.method || 'POST'}
                  onChange={value => onChange('method', value)}
                  options={[
                    { value: 'GET' },
                    { value: 'POST' },
                    { value: 'PUT' },
                    { value: 'PATCH' },
                    { value: 'DELETE' },
                  ]}
                  placeholder="POST"
                />
                <Combobox
                  label="Protocol"
                  value={protocolOperationMetadata?.protocol || ''}
                  onChange={() => {}}
                  options={
                    protocolOperationMetadata
                      ? [
                          {
                            value: protocolOperationMetadata.protocol ?? '',
                          },
                        ]
                      : []
                  }
                  placeholder="Derived from metadata"
                  className="pointer-events-none opacity-70"
                />
              </div>

              <div>
                <OutlinedInput
                  label="Path"
                  value={config.path || ''}
                  onChange={e => onChange('path', e.target.value)}
                  placeholder="/"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Request path relative to the AWS service endpoint
                </p>
              </div>

              <HeadersEditor
                headers={selectedHeaders}
                onChange={handleHeadersChange}
                title="Headers"
                topAddLabel="Add header"
                emptyState={
                  <p className="text-xs text-muted-foreground">
                    Leave empty to use only the operation defaults.
                  </p>
                }
                nameLabel="Header"
                namePlaceholder="x-amz-target"
                valueLabel="Value"
                valuePlaceholder="AmazonSSM.DescribeParameters"
                rowKey={(header, index) => `${header.key}-${index}`}
                removeButtonClassName="shrink-0"
                valueContainerClassName="flex-[1.5]"
              />

              <div>
                <OutlinedTextarea
                  label="Request Body"
                  value={typeof config.body === 'string' ? config.body : ''}
                  onChange={e => onChange('body', e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Raw request body sent after SigV4 signing
                </p>
              </div>

              <div>
                <h4 className="mb-4 text-sm font-medium">Response Parsing</h4>
                <div className="flex flex-col gap-4">
                  <div>
                    <OutlinedInput
                      label="Array Expression"
                      value={(config.arrayExpression as string) ?? '$'}
                      onChange={e =>
                        onChange('arrayExpression', e.target.value)
                      }
                      placeholder="$"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      JSONata expression to extract the list of items from the
                      AWS response
                    </p>
                  </div>

                  <div>
                    <OutlinedInput
                      label="Object ID Expression"
                      value={(config.objectIdExpression as string) ?? 'id'}
                      onChange={e =>
                        onChange('objectIdExpression', e.target.value)
                      }
                      placeholder="id"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      JSONata expression to extract each item&apos;s stable ID
                    </p>
                  </div>
                </div>
              </div>

              <PaginationSettings
                pagination={config.pagination as PaginationConfig | undefined}
                onChange={handlePaginationChange}
                mode="rest"
              />
            </div>
          </AdvancedSection>
        </>
      ) : null}
    </div>
  );
}
