/*
 * Copyright 2024 Larder Software Ltd.
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
import { coreServices } from '@roadiehq/extensions-api';
import { createBackendPlugin } from '@roadiehq/extensions-api';
import { Gauge } from 'prom-client';

export const healthCheck = createBackendPlugin({
  pluginId: 'roadie-healthcheck',

  register(env) {
    env.registerInit({
      deps: {
        rootHttpRouter: coreServices.rootHttpRouter,
        rootLifecycle: coreServices.rootLifecycle,
        logger: coreServices.logger,
      },
      init: async ({ rootHttpRouter, rootLifecycle, logger }) => {
        const upMetric = new Gauge({
          name: 'roadie_backend_up',
          help: 'metric_help',
        });
        upMetric.set(0);

        let status = 'initializing';

        rootLifecycle.addStartupHook(() => {
          upMetric.set(1);
          status = 'running';
          logger.info(`Status is ${status}`, { uptime: process.uptime() });
        });

        rootHttpRouter.use('/healthcheck', (_, res) => {
          return res.status(200).json({ status: 'ok' });
        });

        rootHttpRouter.use('/liveness', (_, res) => {
          return res.status(200).json({ status: 'ok' });
        });

        rootHttpRouter.use('/readiness', (_, res) => {
          if (status === 'running') {
            return res.status(200).json({ status: 'ok' });
          }
          return res.status(500).send({ status: status });
        });
      },
    });
  },
});
