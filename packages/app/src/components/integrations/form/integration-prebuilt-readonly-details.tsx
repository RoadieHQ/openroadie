import React from 'react';
import { useWatch, type Control } from 'react-hook-form';
import { FormSection } from '@roadiehq/ui/form-section';
import {
  INTEGRATION_AUTH_TYPES,
  INTEGRATION_HTTP_BASE_URL_PLACEHOLDER,
} from '../constants';
import type { IntegrationFormValues } from './integration-schema';
import { extractSecretName } from './integration-secret-refs';
import { composeAuthHeaderValue } from './auth-header-value';

function formatSecretOrText(raw: string | undefined): React.ReactNode {
  const t = raw?.trim();
  if (!t) {
    return <span className="text-muted-foreground">—</span>;
  }
  const name = extractSecretName(t);
  if (name) {
    return <span className="font-mono text-sm break-all">{name}</span>;
  }
  return <span className="text-sm break-all">{t}</span>;
}

function ReadonlyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="min-w-0 text-sm text-foreground">{children}</div>
    </div>
  );
}

function OptionalReadonlyRow({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  const t = value?.trim();
  if (!t) {
    return null;
  }
  return (
    <ReadonlyRow label={label}>
      {formatSecretOrText(value ?? undefined)}
    </ReadonlyRow>
  );
}

function headerValuePreviewString(
  prefix: string | undefined,
  secretRef: string | undefined,
): string {
  const secretRaw = secretRef?.trim();
  const secretDisplay = secretRaw
    ? (extractSecretName(secretRaw) ?? secretRaw)
    : '—';
  return composeAuthHeaderValue(prefix, secretDisplay);
}

export function PrebuiltHttpReadonlyDetails({
  control,
}: {
  control: Control<IntegrationFormValues>;
}) {
  const host = useWatch({ control, name: 'host' });
  const authType = useWatch({ control, name: 'authType' });
  const authHeaders = useWatch({ control, name: 'authHeaders' });
  const basicUsername = useWatch({ control, name: 'basicUsername' });
  const basicPassword = useWatch({ control, name: 'basicPassword' });
  const bearerToken = useWatch({ control, name: 'bearerToken' });
  const oauth2TokenUrl = useWatch({ control, name: 'oauth2TokenUrl' });
  const oauth2ClientId = useWatch({ control, name: 'oauth2ClientId' });
  const oauth2ClientSecret = useWatch({ control, name: 'oauth2ClientSecret' });
  const oauth2Audience = useWatch({ control, name: 'oauth2Audience' });
  const oauth2Scope = useWatch({ control, name: 'oauth2Scope' });
  const jwtIssuer = useWatch({ control, name: 'jwtIssuer' });
  const jwtPrivateKey = useWatch({ control, name: 'jwtPrivateKey' });
  const jwtTokenUrl = useWatch({ control, name: 'jwtTokenUrl' });
  const jwtAudience = useWatch({ control, name: 'jwtAudience' });
  const jwtScope = useWatch({ control, name: 'jwtScope' });
  const jwtSubject = useWatch({ control, name: 'jwtSubject' });

  const authTypeLabel =
    INTEGRATION_AUTH_TYPES.find(t => t.value === authType)?.label ??
    (authType ? String(authType) : '—');

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <FormSection title="Connection" className="mt-0" />
        <div className="mt-3 space-y-4">
          <ReadonlyRow label="URL">
            {(host ?? '').trim() ? (
              formatSecretOrText(host)
            ) : (
              <span className="text-muted-foreground">
                {INTEGRATION_HTTP_BASE_URL_PLACEHOLDER}
              </span>
            )}
          </ReadonlyRow>
        </div>
      </div>

      <div>
        <FormSection title="Authentication" className="mt-0" />
        <div className="mt-3 space-y-4">
          <ReadonlyRow label="Auth type">{authTypeLabel}</ReadonlyRow>

          {authType === 'header' &&
            ((authHeaders?.length ?? 0) > 0 ? (
              <div className="space-y-2">
                {(authHeaders ?? []).map((h, i) => {
                  const name = h.key?.trim() || '—';
                  const line = `${name}: ${headerValuePreviewString(h.prefix, h.value)}`;
                  return (
                    <div
                      key={i}
                      className="rounded-md border border-divider bg-muted/30 px-3 py-2.5 dark:bg-muted/15"
                    >
                      <p className="font-mono text-sm leading-snug break-all text-foreground">
                        {line}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <ReadonlyRow label="Headers">
                <span className="text-muted-foreground">—</span>
              </ReadonlyRow>
            ))}

          {authType === 'basic' && (
            <>
              <ReadonlyRow label="Username secret">
                {formatSecretOrText(basicUsername)}
              </ReadonlyRow>
              <ReadonlyRow label="Password secret">
                {formatSecretOrText(basicPassword)}
              </ReadonlyRow>
            </>
          )}

          {authType === 'bearer-token' && (
            <ReadonlyRow label="Bearer token secret">
              {formatSecretOrText(bearerToken)}
            </ReadonlyRow>
          )}

          {authType === 'oauth2-client-credentials' && (
            <>
              <ReadonlyRow label="Token URL">
                {formatSecretOrText(oauth2TokenUrl)}
              </ReadonlyRow>
              <ReadonlyRow label="Client ID secret">
                {formatSecretOrText(oauth2ClientId)}
              </ReadonlyRow>
              <ReadonlyRow label="Client secret">
                {formatSecretOrText(oauth2ClientSecret)}
              </ReadonlyRow>
              <OptionalReadonlyRow label="Audience" value={oauth2Audience} />
              <OptionalReadonlyRow label="Scope" value={oauth2Scope} />
            </>
          )}

          {authType === 'oauth2-jwt-bearer' && (
            <>
              <ReadonlyRow label="Issuer / Client ID secret">
                {formatSecretOrText(jwtIssuer)}
              </ReadonlyRow>
              <ReadonlyRow label="Private key secret">
                {formatSecretOrText(jwtPrivateKey)}
              </ReadonlyRow>
              <ReadonlyRow label="Token URL">
                {formatSecretOrText(jwtTokenUrl)}
              </ReadonlyRow>
              <OptionalReadonlyRow label="Audience" value={jwtAudience} />
              <OptionalReadonlyRow label="Scope" value={jwtScope} />
              <OptionalReadonlyRow label="Subject" value={jwtSubject} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
