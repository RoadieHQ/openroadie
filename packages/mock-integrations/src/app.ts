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
import express, { Express, Request, Response } from 'express';
import { FixtureStorage, fixtureKey } from './storage';

export function createApp(storage: FixtureStorage): Express {
  const app = express();

  // Parse JSON bodies so same-URL requests differentiated by payload (GraphQL)
  // resolve to distinct fixtures. Non-JSON bodies fall through as undefined.
  app.use(express.json({ limit: '10mb' }));

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.all('/:integration/*', async (req: Request, res: Response) => {
    const { integration } = req.params;
    const path = req.params[0] ?? '';
    const queryString = req.originalUrl.split('?')[1] ?? '';
    const hasBody = req.body && Object.keys(req.body).length > 0;
    const key = fixtureKey(
      integration,
      req.method,
      path,
      queryString,
      hasBody ? req.body : undefined,
    );
    // Rolling-window POST bodies (e.g. "last 7 days" date ranges) never
    // re-hash to the recorded value, so a body-keyed miss falls back to the
    // URL-only key. Exact body matches (GraphQL operations) still win.
    const fallbackKey = hasBody
      ? fixtureKey(integration, req.method, path, queryString)
      : undefined;

    try {
      const stored =
        (await storage.get(key)) ??
        (fallbackKey ? await storage.get(fallbackKey) : undefined);
      if (!stored) {
        res.status(404).json({
          error: 'No fixture recorded for this request',
          missingKey: key,
        });
        return;
      }
      for (const [name, value] of Object.entries(stored.headers ?? {})) {
        res.setHeader(name, value);
      }
      res.status(stored.status).json(stored.body);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message, key });
    }
  });

  return app;
}
