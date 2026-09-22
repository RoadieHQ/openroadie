/*
 * Copyright 2022 The Backstage Authors
 * Modifications copyright 2026 Larder Software Limited
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
 *
 * Derived from Backstage (https://github.com/backstage/backstage),
 * packages/backend-defaults/src/entrypoints/rootLogger/rootLoggerServiceFactory.ts at v1.47.1, and modified.
 */

import { redactWinstonLogLine } from '@roadiehq/backend-common';
import { coreServices, createServiceFactory } from '@roadiehq/extensions-api';
import { WinstonLogger } from './WinstonLogger';
import { format, transports } from 'winston';
import { v4 as uuid } from 'uuid';
import { getRootLoggerConfig } from './config';

export { type RootLoggerConfig, type RootLoggerLevelOverride } from './types';

export const rootLoggerServiceFactory = createServiceFactory({
  service: coreServices.rootLogger,
  deps: {
    config: coreServices.rootConfig,
  },
  async factory({ config }) {
    const runtimeInstanceId = uuid();
    const shortRuntimeInstanceId = runtimeInstanceId.slice(0, 8);
    const rootLoggerConfig = getRootLoggerConfig(config);

    const logger = WinstonLogger.create({
      meta: {
        service: 'roadie',
        ri: shortRuntimeInstanceId,
        ...rootLoggerConfig.meta,
      },
      level: process.env.LOG_LEVEL || rootLoggerConfig.level || 'info',
      format: process.env.DEV_MODE
        ? WinstonLogger.colorFormat()
        : format.combine(
            format(redactWinstonLogLine)(),
            format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
            format.json(),
          ),
      transports: [new transports.Console()],
    });

    logger.setLevelOverrides(rootLoggerConfig.overrides ?? []);
    config.subscribe?.(() =>
      logger.setLevelOverrides(getRootLoggerConfig(config).overrides ?? []),
    );

    logger.info(
      `Starting root logger with runtime instance id ${shortRuntimeInstanceId}`,
    );

    return logger;
  },
});
