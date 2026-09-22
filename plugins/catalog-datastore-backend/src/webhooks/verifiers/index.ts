/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { LoggerService, RootConfigService } from '@roadiehq/extensions-api';
import type { Request } from 'express';
import { WebhookTokenDao } from '../../database/WebhookTokenDao';
import { DbTokenVerifier } from './DbTokenVerifier';
import { PublicVerifier } from './PublicVerifier';
import { SharedSecretVerifier } from './SharedSecretVerifier';
import { BearerVerifier } from './types';

export { DbTokenVerifier } from './DbTokenVerifier';
export { PublicVerifier } from './PublicVerifier';
export { SharedSecretVerifier } from './SharedSecretVerifier';
export type { BearerVerifier } from './types';

/**
 * Selects the bearer-auth strategy from config:
 *
 *   roadie:
 *     webhooks:
 *       auth:
 *         public: true                             # rely on upstream /api auth
 *         sharedSecret: ${WEBHOOK_SHARED_SECRET}   # provisioned via SSM/env
 *
 * If `roadie.webhooks.auth.public` is true, the public webhook endpoints do
 * not require their own bearer token. Use this only when a deployment-level
 * auth layer already protects /api. Otherwise, if
 * `roadie.webhooks.auth.sharedSecret` is present, we use the shared-secret
 * verifier. The default is DB-backed verifier (single-tenant / dev), which
 * mints tokens via the admin UI.
 */
export function createBearerVerifier(opts: {
  config: RootConfigService;
  tokenDao: WebhookTokenDao;
  logger: LoggerService;
  resolveWorkspaceId?: (req: Request) => Promise<string>;
  workspaceExists?: (workspaceId: string) => Promise<boolean>;
}): BearerVerifier {
  const { config, tokenDao, logger } = opts;
  if (config.getOptionalBoolean('roadie.webhooks.auth.public')) {
    logger.info('Webhook bearer auth: public mode');
    return new PublicVerifier(opts.resolveWorkspaceId);
  }

  const sharedSecret = config.getOptionalString(
    'roadie.webhooks.auth.sharedSecret',
  );
  if (sharedSecret) {
    logger.info(
      'Webhook bearer auth: shared-secret mode (roadie.webhooks.auth.sharedSecret)',
    );
    return new SharedSecretVerifier(sharedSecret);
  }
  logger.info('Webhook bearer auth: DB-token mode (admin-minted tokens)');
  return new DbTokenVerifier(tokenDao, opts.workspaceExists);
}
