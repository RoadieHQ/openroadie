import { queryOptions } from '@tanstack/react-query';
import { SecretStatusType, type Secret } from '../../api/secrets';
import { queryKeys } from '../../api/queries';

export type SecretRequirement = {
  ref: string;
  secret?: Secret;
  missing: boolean;
};

/**
 * The per-ref `getSecret` fan-out that resolves each requirement's
 * availability. Shared by the required-secrets panel and the integration
 * secret-status hook so both hit one cache entry and one invalidation
 * (`queryKeys.resolvedSecretsPrefix`). Co-located here rather than in
 * `queries.ts` because the `queryFn` depends on `resolveSecretRequirement`.
 */
export function resolvedSecretsQuery(
  secrets: { getSecret: (secret: string) => Promise<Secret> },
  refs: readonly string[],
) {
  return queryOptions({
    queryKey: queryKeys.resolvedSecrets(refs),
    // Bind lazily inside the queryFn: the factory runs on every render (even
    // when the query is disabled), and `getSecret` may be absent then.
    queryFn: () =>
      Promise.all(
        refs.map(ref =>
          resolveSecretRequirement(secrets.getSecret.bind(secrets), ref),
        ),
      ),
  });
}

export async function resolveSecretRequirement(
  getSecret: (secret: string) => Promise<Secret>,
  ref: string,
): Promise<SecretRequirement> {
  try {
    const secret = await getSecret(ref);
    return {
      ref,
      secret,
      missing: secret.status !== SecretStatusType.Available,
    };
  } catch {
    return {
      ref,
      missing: true,
    };
  }
}
