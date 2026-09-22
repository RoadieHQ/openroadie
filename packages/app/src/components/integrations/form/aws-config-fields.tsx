import React from 'react';
import {
  useFieldArray,
  useFormState,
  useWatch,
  type Control,
} from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { OutlinedInput } from '@roadiehq/ui/outlined-input';
import { OutlinedSelect } from '@roadiehq/ui/outlined-select';
import { Combobox } from '@roadiehq/ui/combobox';
import { MultiCombobox } from '@roadiehq/ui/multi-combobox';
import { Switch } from '@roadiehq/ui/switch';
import { Button } from '@roadiehq/ui/button';
import { Separator } from '@roadiehq/ui/separator';
import { AdvancedSection } from '@roadiehq/ui/advanced-section';
import {
  FormField,
  FormItem,
  FormControl,
  FormDescription,
  FormMessage,
} from '@roadiehq/ui/form';
import { SelectItem } from '@roadiehq/ui/select';
import type { IntegrationFormValues } from './integration-schema';
import { AwsTrustSetupPanel, useAwsTrustSetup } from './aws-trust-setup-panel';

const STRICT_EXTERNAL_ID_DESCRIPTION =
  'Ignored: strict mode derives and enforces its own external ID for every account, shown in the AWS trust policy below.';

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

const AWS_REGION_OPTIONS = AWS_REGIONS.map(r => ({ value: r }));

type AwsTagFieldName =
  | 'awsOrganizations.requiredTags'
  | 'awsOrganizations.excludedTags';

interface AwsTagFieldsProps {
  control: Control<IntegrationFormValues>;
  name: AwsTagFieldName;
  title: string;
  description: string;
  addLabel: string;
  readOnly: boolean;
}

function AwsTagFields({
  control,
  name,
  title,
  description,
  addLabel,
  readOnly,
}: AwsTagFieldsProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name,
  });

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-sm font-medium">{title}</h4>
        <p className="text-xs leading-normal text-muted-foreground">
          {description}
        </p>
      </div>

      {fields.length > 0 ? (
        <div className="space-y-2">
          {fields.map((item, index) => (
            <div key={item.id} className="flex items-start gap-2">
              <FormField
                control={control}
                name={`${name}.${index}.key`}
                render={({ field }) => (
                  <FormItem className="flex-1 space-y-1">
                    <FormControl>
                      <OutlinedInput
                        label="Tag Key"
                        placeholder="Environment"
                        disabled={readOnly}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name={`${name}.${index}.value`}
                render={({ field }) => (
                  <FormItem className="flex-1 space-y-1">
                    <FormControl>
                      <OutlinedInput
                        label="Tag Value"
                        placeholder="prod"
                        disabled={readOnly}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!readOnly ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-1 shrink-0"
                  onClick={() => remove(index)}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {!readOnly ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append({ key: '', value: '' })}
          className="w-fit border-primary/30 bg-primary/5 hover:bg-primary/10"
        >
          <Plus className="mr-1 size-3.5" />
          {addLabel}
        </Button>
      ) : null}
    </div>
  );
}

interface AwsConfigFieldsProps {
  control: Control<IntegrationFormValues>;
  readOnly?: boolean;
  integrationId?: string;
}

export function AwsConfigFields({
  control,
  readOnly = false,
  integrationId,
}: AwsConfigFieldsProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'awsProfiles',
  });
  const { errors } = useFormState({ control, name: 'awsProfiles' });
  // The form resolver places array-root issues at the container level
  // (errors.awsProfiles.message), not RHF's `.root` convention — read both.
  const awsProfilesError =
    'awsProfiles' in errors ? errors.awsProfiles : undefined;
  const awsProfilesRootError =
    awsProfilesError?.message ?? awsProfilesError?.root?.message;
  const organizationsEnabled = useWatch({
    control,
    name: 'awsOrganizations.enabled',
  });
  const memberExternalIdMode =
    useWatch({
      control,
      name: 'awsOrganizations.memberExternalIdMode',
    }) ?? 'static';
  // In strict mode the backend ignores every configured external ID and
  // derives its own per tenant (assume-role-policy.ts, deriveExternalId) — so
  // these fields are dead input once strict mode is on, not just optional.
  const { data: trustSetup } = useAwsTrustSetup(integrationId);
  const strictExternalId = trustSetup?.strict ?? false;

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-sm font-medium">AWS Accounts</h3>
            <p className="text-xs leading-normal text-muted-foreground">
              Manual account profiles stay selectable in AWS data sources and
              override organization defaults for matching accounts.
            </p>
          </div>
          {!readOnly ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-primary hover:bg-primary/10 hover:text-primary"
              onClick={() =>
                append({
                  name: '',
                  accountId: '',
                  roleName: '',
                  externalId: '',
                  region: '',
                })
              }
            >
              <Plus className="size-3.5" />
              Add account
            </Button>
          ) : null}
        </div>

        {typeof awsProfilesRootError === 'string' && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {awsProfilesRootError}
          </p>
        )}

        {fields.length > 0 ? (
          <div className="space-y-4">
            {fields.map((item, index) => (
              <div
                key={item.id}
                className="rounded-lg border border-divider p-4"
              >
                <FormField
                  control={control}
                  name={`awsProfiles.${index}.name`}
                  render={({ field }) => (
                    <FormItem className="mb-4 space-y-1">
                      <div className="flex items-center gap-3">
                        <FormControl className="min-w-0 flex-1">
                          <OutlinedInput
                            label="Profile Name"
                            placeholder="Production"
                            disabled={readOnly}
                            {...field}
                            value={field.value ?? ''}
                          />
                        </FormControl>
                        {!readOnly ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            onClick={() => remove(index)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                      <FormDescription>
                        Friendly label shown in AWS profile selectors
                      </FormDescription>
                    </FormItem>
                  )}
                />
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={control}
                    name={`awsProfiles.${index}.accountId`}
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormControl>
                          <OutlinedInput
                            label="Account ID"
                            required
                            placeholder="123456789012"
                            disabled={readOnly}
                            {...field}
                            value={field.value ?? ''}
                          />
                        </FormControl>
                        <FormDescription>
                          The 12-digit AWS account ID
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={control}
                    name={`awsProfiles.${index}.region`}
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormControl>
                          <Combobox
                            label="Default Region"
                            placeholder="us-east-1"
                            value={field.value ?? ''}
                            onChange={field.onChange}
                            options={AWS_REGION_OPTIONS}
                            disabled={readOnly}
                          />
                        </FormControl>
                        <FormDescription>
                          Default AWS region for this account
                        </FormDescription>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={control}
                    name={`awsProfiles.${index}.roleName`}
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormControl>
                          <OutlinedInput
                            label="Role Name"
                            placeholder="MyRoleName or arn:aws:iam::123456789012:role/MyRole"
                            disabled={readOnly}
                            {...field}
                            value={field.value ?? ''}
                          />
                        </FormControl>
                        <FormDescription>
                          IAM role name or ARN that Roadie will assume
                        </FormDescription>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={control}
                    name={`awsProfiles.${index}.externalId`}
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormControl>
                          <OutlinedInput
                            label="External ID"
                            placeholder="Optional external ID for cross-account access"
                            disabled={readOnly || strictExternalId}
                            {...field}
                            value={field.value ?? ''}
                          />
                        </FormControl>
                        <FormDescription>
                          {strictExternalId
                            ? STRICT_EXTERNAL_ID_DESCRIPTION
                            : 'Used for secure cross-account role assumption'}
                        </FormDescription>
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-divider p-4 text-sm text-muted-foreground">
            No manual AWS account profiles configured.
          </div>
        )}

        <AdvancedSection
          label="AWS trust policy"
          variant="embedded"
          className="mt-2"
        >
          <AwsTrustSetupPanel integrationId={integrationId} />
        </AdvancedSection>
      </div>

      <div className="rounded-lg border border-divider p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">AWS Organizations</h3>
            <p className="text-xs leading-normal text-muted-foreground">
              Use a management account to discover member accounts live in the
              data source editor and apply shared defaults to them at runtime.
            </p>
          </div>
          <FormField
            control={control}
            name="awsOrganizations.enabled"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Switch
                    checked={Boolean(field.value)}
                    onCheckedChange={field.onChange}
                    disabled={readOnly}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        {organizationsEnabled ? (
          <div className="mt-4 flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={control}
                name="awsOrganizations.managementAccountId"
                render={({ field }) => (
                  <FormItem className="min-w-0 space-y-1">
                    <FormControl>
                      <OutlinedInput
                        label="Management Account ID"
                        required
                        placeholder="123456789012"
                        disabled={readOnly}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormDescription>
                      Account used for Organizations discovery calls
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="awsOrganizations.managementRegion"
                render={({ field }) => (
                  <FormItem className="min-w-0 space-y-1">
                    <FormControl>
                      <Combobox
                        label="Management Account Region"
                        placeholder="us-east-1"
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        options={AWS_REGION_OPTIONS}
                        disabled={readOnly}
                      />
                    </FormControl>
                    <FormDescription>
                      Region used when assuming the management account role
                    </FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="awsOrganizations.managementRoleName"
                render={({ field }) => (
                  <FormItem className="min-w-0 space-y-1">
                    <FormControl>
                      <OutlinedInput
                        label="Management Role Name"
                        placeholder="MyAssumeRole or arn:aws:iam::123456789012:role/MyRole"
                        disabled={readOnly}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormDescription>
                      Optional role or ARN used for Organizations API access
                    </FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="awsOrganizations.managementExternalId"
                render={({ field }) => (
                  <FormItem className="min-w-0 space-y-1">
                    <FormControl>
                      <OutlinedInput
                        label="Management External ID"
                        placeholder="Optional external ID"
                        disabled={readOnly || strictExternalId}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormDescription>
                      {strictExternalId
                        ? STRICT_EXTERNAL_ID_DESCRIPTION
                        : 'External ID used when assuming the management role'}
                    </FormDescription>
                  </FormItem>
                )}
              />
            </div>

            <Separator className="bg-divider" />

            <div className="grid gap-4 md:grid-cols-3">
              <FormField
                control={control}
                name="awsOrganizations.defaultRoleName"
                render={({ field }) => (
                  <FormItem className="min-w-0 space-y-1">
                    <FormControl>
                      <OutlinedInput
                        label="Member Role Name"
                        placeholder="OrganizationAccountAccessRole"
                        disabled={readOnly}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormDescription>
                      Default role applied to discovered member accounts
                    </FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="awsOrganizations.memberExternalIdMode"
                render={({ field }) => (
                  <FormItem className="min-w-0 space-y-1">
                    <FormControl>
                      <OutlinedSelect
                        label="Member External ID Mode"
                        value={field.value ?? 'static'}
                        onValueChange={field.onChange}
                        disabled={readOnly}
                      >
                        <SelectItem
                          value="static"
                          className="px-4 py-1.5 text-base"
                        >
                          Static external ID
                        </SelectItem>
                        <SelectItem
                          value="prefix"
                          className="px-4 py-1.5 text-base"
                        >
                          Derived from prefix per account
                        </SelectItem>
                      </OutlinedSelect>
                    </FormControl>
                    <FormDescription>
                      External ID mode for discovered member accounts.
                    </FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="awsOrganizations.defaultRegion"
                render={({ field }) => (
                  <FormItem className="min-w-0 space-y-1">
                    <FormControl>
                      <Combobox
                        label="Member Region"
                        placeholder="us-east-1"
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        options={AWS_REGION_OPTIONS}
                        disabled={readOnly}
                      />
                    </FormControl>
                    <FormDescription>
                      Default region for discovered member accounts
                    </FormDescription>
                  </FormItem>
                )}
              />
            </div>

            {memberExternalIdMode === 'prefix' ? (
              <FormField
                control={control}
                name="awsOrganizations.defaultExternalIdPrefix"
                render={({ field }) => (
                  <FormItem className="min-w-0 space-y-1">
                    <FormControl>
                      <OutlinedInput
                        label="Member External ID Prefix"
                        placeholder="Optional prefix"
                        disabled={readOnly || strictExternalId}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormDescription>
                      {strictExternalId
                        ? STRICT_EXTERNAL_ID_DESCRIPTION
                        : "Roadie derives each member account's external ID by base64-encoding prefix-accountId."}
                    </FormDescription>
                  </FormItem>
                )}
              />
            ) : (
              <FormField
                control={control}
                name="awsOrganizations.defaultExternalId"
                render={({ field }) => (
                  <FormItem className="min-w-0 space-y-1">
                    <FormControl>
                      <OutlinedInput
                        label="Member External ID"
                        placeholder="Optional external ID"
                        disabled={readOnly || strictExternalId}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormDescription>
                      {strictExternalId
                        ? STRICT_EXTERNAL_ID_DESCRIPTION
                        : 'Default external ID for discovered member accounts'}
                    </FormDescription>
                  </FormItem>
                )}
              />
            )}

            <AdvancedSection label="Exclusions & filtering" variant="embedded">
              <FormField
                control={control}
                name="awsOrganizations.excludeManagementAccount"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border border-divider p-3">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">
                        Exclude management account by default
                      </div>
                      <FormDescription>
                        Keeps the management account out of live account lists
                        and dynamic select-all sources unless you add it
                        manually.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={Boolean(field.value)}
                        onCheckedChange={field.onChange}
                        disabled={readOnly}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="awsOrganizations.excludedAccountIds"
                render={({ field }) => (
                  <FormItem className="min-w-0 space-y-1">
                    <FormControl>
                      <MultiCombobox
                        label="Excluded Account IDs"
                        values={field.value ?? []}
                        onChange={field.onChange}
                        options={[]}
                        placeholder="Type an account ID, then use space or comma"
                        allowCustomValues
                        customValueSplitPattern={/[\s,]+/}
                        disabled={readOnly}
                      />
                    </FormControl>
                    <FormDescription>
                      Hard exclusions applied before any source-level selection.
                      Separate IDs with a space or comma to create chips.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <AwsTagFields
                control={control}
                name="awsOrganizations.requiredTags"
                title="Required Tags"
                description="Discovered accounts must match every required tag."
                addLabel="Add required tag"
                readOnly={readOnly}
              />

              <AwsTagFields
                control={control}
                name="awsOrganizations.excludedTags"
                title="Excluded Tags"
                description="Accounts matching any excluded tag are filtered out."
                addLabel="Add excluded tag"
                readOnly={readOnly}
              />
            </AdvancedSection>
          </div>
        ) : (
          <p className="mt-4 text-xs text-muted-foreground">
            Enable AWS Organizations to discover accounts live instead of
            maintaining only static account profiles.
          </p>
        )}
      </div>
    </div>
  );
}
