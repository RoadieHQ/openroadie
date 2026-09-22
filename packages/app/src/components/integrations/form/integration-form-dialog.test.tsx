import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { renderWithQuery as render } from '../../../test-utils';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationFormDialog } from './integration-form-dialog';
import type { IntegrationFormValues } from './integration-schema';
import type { Integration } from '../types';

const mockUseIntegrationForm = vi.fn();

vi.mock('./use-integration-form', () => ({
  useIntegrationForm: (...args: unknown[]) => mockUseIntegrationForm(...args),
}));

const { mockCreate, mockWorkflowsApi, mockAlertApi, mockSecretsApi } =
  vi.hoisted(() => {
    const create = vi.fn();
    return {
      mockCreate: create,
      mockWorkflowsApi: {
        integrations: {
          listLogos: vi.fn().mockResolvedValue([]),
          create,
          update: vi.fn(),
        },
      },
      mockAlertApi: { post: vi.fn() },
      mockSecretsApi: {
        getKeys: vi.fn().mockResolvedValue([]),
        getMetadata: vi.fn().mockResolvedValue([]),
        getStorageMode: vi
          .fn()
          .mockResolvedValue({ mode: 'dotenv', readOnly: false }),
      },
    };
  });

vi.mock('../../../api', () => ({
  useWorkflows: () => mockWorkflowsApi,
  useAlert: () => mockAlertApi,
  useSecrets: () => mockSecretsApi,
}));

const { useIntegrationForm: actualUseIntegrationForm } = await vi.importActual<
  typeof import('./use-integration-form')
>('./use-integration-form');

vi.mock('./logo-picker', () => ({
  LogoPicker: () => <div data-testid="logo-picker" />,
}));

vi.mock('./required-secrets-panel', () => ({
  RequiredSecretsPanel: () => <div data-testid="required-secrets-panel" />,
}));

vi.mock('./http-config-fields', async () => {
  const actual = await vi.importActual<typeof import('./http-config-fields')>(
    './http-config-fields',
  );

  return {
    ...actual,
    HttpConnectionFields: () => <div data-testid="http-connection-fields" />,
    HttpAuthFields: () => <div data-testid="http-auth-fields" />,
  };
});

function TestUseIntegrationForm() {
  const form = useForm<IntegrationFormValues>({
    mode: 'onChange',
    defaultValues: {
      name: 'GitHub',
      slug: 'github',
      type: 'scm',
      logoSlug: '',
      backendType: 'http',
      host: 'https://api.github.com',
      authType: 'none',
      authHeaders: [],
      basicUsername: '',
      basicPassword: '',
      bearerToken: '',
      oauth2ClientId: '',
      oauth2ClientSecret: '',
      oauth2TokenUrl: '',
      oauth2Audience: '',
      oauth2Scope: '',
      jwtIssuer: '',
      jwtPrivateKey: '',
      jwtTokenUrl: '',
      jwtAudience: '',
      jwtScope: '',
      jwtSubject: '',
      defaultHeaders: [{ key: 'X-Test', value: 'value' }],
      requestsPerHour: '10',
      requestsPerSecond: '1',
      burstCapacity: '2',
      caCertificate:
        '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
      graphqlPath: '',
    },
  });

  const handleSave = vi.fn();

  return {
    form,
    saving: false,
    isEdit: true,
    autoSlug: false,
    secretOptions: [],
    reservedSecretNames: [],
    handleSave,
    refreshSecretList: vi.fn(),
    secretsListReadOnly: false,
    logoCatalog: [],
  };
}

function makeIntegration(overrides?: Partial<Integration>): Integration {
  return {
    id: 'int-1',
    name: 'GitHub',
    slug: 'github',
    type: 'scm',
    host: 'https://api.github.com',
    backendType: 'http',
    authType: 'none',
    authConfig: null,
    config: {},
    createdBy: 'system',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    logoUrl: '',
    ...overrides,
  };
}

describe('IntegrationFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps headers and CA certificate editable for pre-built integrations', async () => {
    const user = userEvent.setup();
    mockUseIntegrationForm.mockImplementation(TestUseIntegrationForm);

    render(
      <IntegrationFormDialog
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
        integration={makeIntegration()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Advanced' }));

    const paginationTypeLabel = screen.getByText('Pagination Type');
    const paginationTypeTrigger =
      paginationTypeLabel.parentElement?.querySelector('button');

    expect(screen.getByLabelText('Name *')).toBeEnabled();
    expect(screen.getByLabelText('Requests / hour')).toBeDisabled();
    expect(paginationTypeTrigger).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add Header' })).toBeEnabled();
    expect(screen.getByLabelText('CA certificate (PEM)')).toBeEnabled();
  });

  it('disables save changes until an edit is made', async () => {
    const user = userEvent.setup();
    mockUseIntegrationForm.mockImplementation(TestUseIntegrationForm);

    render(
      <IntegrationFormDialog
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
        integration={makeIntegration({ createdBy: 'user-1' })}
      />,
    );

    const saveButton = screen.getByRole('button', { name: 'Save Changes' });
    expect(saveButton).toBeDisabled();

    await user.type(screen.getByLabelText('Name *'), ' Updated');

    expect(saveButton).toBeEnabled();
  });

  it('shows the awsProfiles root error and blocks create when an AWS integration has no accounts', async () => {
    const user = userEvent.setup();
    mockUseIntegrationForm.mockImplementation(actualUseIntegrationForm);

    render(
      <IntegrationFormDialog
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
        template={makeIntegration({
          backendType: 'aws',
          authType: 'none',
          host: '',
          config: {},
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Create' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Add at least one AWS account or enable AWS Organizations',
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates only once when Create is clicked twice during a slow save', async () => {
    const user = userEvent.setup();
    mockUseIntegrationForm.mockImplementation(actualUseIntegrationForm);
    let resolveCreate: (integration: Integration) => void = () => {};
    mockCreate.mockImplementation(
      () =>
        new Promise<Integration>(resolve => {
          resolveCreate = resolve;
        }),
    );
    const onClose = vi.fn();

    render(
      <IntegrationFormDialog
        open
        onClose={onClose}
        onSaved={vi.fn()}
        template={makeIntegration()}
      />,
    );

    const createButton = screen.getByRole('button', { name: 'Create' });
    await user.click(createButton);
    await user.click(createButton);

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));

    resolveCreate(makeIntegration());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('submits when Enter is pressed in the Name field', async () => {
    const user = userEvent.setup();
    mockUseIntegrationForm.mockImplementation(actualUseIntegrationForm);
    mockCreate.mockResolvedValue(makeIntegration());

    render(
      <IntegrationFormDialog
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
        template={makeIntegration()}
      />,
    );

    await user.type(screen.getByLabelText('Name *'), '{Enter}');

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  });

  it('asks for confirmation before discarding unsaved changes on cancel', async () => {
    const user = userEvent.setup();
    mockUseIntegrationForm.mockImplementation(TestUseIntegrationForm);
    const onClose = vi.fn();

    render(
      <IntegrationFormDialog
        open
        onClose={onClose}
        onSaved={vi.fn()}
        integration={makeIntegration({ createdBy: 'user-1' })}
      />,
    );

    await user.type(screen.getByLabelText('Name *'), ' Updated');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Discard' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes immediately on cancel when the form is pristine', async () => {
    const user = userEvent.setup();
    mockUseIntegrationForm.mockImplementation(TestUseIntegrationForm);
    const onClose = vi.fn();

    render(
      <IntegrationFormDialog
        open
        onClose={onClose}
        onSaved={vi.fn()}
        integration={makeIntegration({ createdBy: 'user-1' })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.queryByText('Discard unsaved changes?'),
    ).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('removes a header row without submitting the form', async () => {
    const user = userEvent.setup();
    mockUseIntegrationForm.mockImplementation(actualUseIntegrationForm);

    render(
      <IntegrationFormDialog
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
        template={makeIntegration({
          config: { headers: { 'X-Test': 'value' } },
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Advanced' }));

    const headerValueInput = screen.getByLabelText('Header value');
    const row = headerValueInput.closest('div.flex.items-center.gap-2');
    expect(row).not.toBeNull();
    const rowButtons = within(row as HTMLElement).getAllByRole('button');
    await user.click(rowButtons[rowButtons.length - 1]);

    expect(screen.queryByLabelText('Header value')).not.toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
