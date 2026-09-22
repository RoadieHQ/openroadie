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
import type { RequestHandler } from 'express';
import { InputError, NotAllowedError } from '@roadiehq/errors';
import { BearerVerifier } from './verifiers';

const BEARER_PREFIX = 'Bearer ';

export function createBearerAuthMiddleware(options: {
  verifier: BearerVerifier;
  onVerified: (req: Parameters<RequestHandler>[0], workspaceId: string) => void;
}): RequestHandler {
  const { verifier, onVerified } = options;
  return async (req, res, next) => {
    try {
      if (verifier.requiresBearer === false) {
        const result = await verifier.verify('', req);
        if (!result) {
          res.status(401).json({ error: { message: 'invalid bearer token' } });
          return;
        }
        onVerified(req, result.workspaceId);
        next();
        return;
      }

      const header = req.header('authorization');
      if (!header || !header.startsWith(BEARER_PREFIX)) {
        res
          .status(401)
          .json({ error: { message: 'missing or malformed bearer token' } });
        return;
      }
      const plaintext = header.slice(BEARER_PREFIX.length).trim();
      if (!plaintext) {
        res.status(401).json({ error: { message: 'empty bearer token' } });
        return;
      }
      const result = await verifier.verify(plaintext, req);
      if (!result) {
        res.status(401).json({ error: { message: 'invalid bearer token' } });
        return;
      }
      onVerified(req, result.workspaceId);
      next();
      return;
    } catch (error) {
      if (error instanceof InputError) {
        res.status(400).json({ error: { message: error.message } });
        return;
      }
      if (error instanceof NotAllowedError) {
        res.status(403).json({ error: { message: error.message } });
        return;
      }
      next(error);
    }
  };
}
