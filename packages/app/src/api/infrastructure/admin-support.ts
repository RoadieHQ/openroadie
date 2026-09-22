import type { AuthSession } from './auth';
import type { AppConfig } from './config';

const ADMIN_SUPPORT_PATH = '/api/secrets-settings/storage-mode';

function getAdminSupportUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}${ADMIN_SUPPORT_PATH}`;
}

export async function resolveAdminConfig(
  config: AppConfig,
  auth?: AuthSession,
): Promise<AppConfig> {
  if (typeof config.features?.admin === 'boolean') {
    return config;
  }

  const headers: Record<string, string> = {
    ...(config.backend.headers ?? {}),
  };

  if (auth) {
    headers.Authorization = `Bearer ${await auth.getAccessToken()}`;
  }

  try {
    const response = await fetch(getAdminSupportUrl(config.backend.baseUrl), {
      headers,
      ...(auth ? {} : { credentials: 'include' as const }),
    });

    return {
      ...config,
      features: {
        ...config.features,
        admin: response.status !== 404,
      },
    };
  } catch {
    return {
      ...config,
      features: {
        ...config.features,
        admin: false,
      },
    };
  }
}
