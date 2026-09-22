import type { Request } from 'express';
import type { HttpAuthService } from '@roadiehq/extensions-api';

export interface WorkspaceCaller {
  userId?: string;
  service: boolean;
}

export async function resolveWorkspaceCaller(
  httpAuth: HttpAuthService,
  req: Request,
): Promise<WorkspaceCaller> {
  try {
    const credentials = await httpAuth.credentials(req, {
      allow: ['user', 'service', 'none'],
    });
    if (credentials.principal.type === 'service') {
      return { service: true };
    }
    if (credentials.principal.type !== 'user') {
      return { service: false };
    }
    return {
      userId: credentials.principal.userId,
      service:
        credentials.principal.actor?.type === 'service' ||
        credentials.principal.userId.startsWith('rst:'),
    };
  } catch {
    return { service: true };
  }
}
