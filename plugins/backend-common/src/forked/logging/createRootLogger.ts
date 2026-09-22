import { merge } from 'lodash';
import * as winston from 'winston';
import { LoggerOptions } from 'winston';
import { WinstonLogger } from '@roadiehq/backend-defaults';
import { getRedacter } from './redactors';

let rootLogger: winston.Logger;

/**
 * Sets a completely custom default "root" logger.
 *
 * @remarks
 *
 * This is the logger instance that will be the foundation for all other logger
 * instances passed to plugins etc, in a given backend.
 *
 * Only use this if you absolutely need to make a completely custom logger.
 * Normally if you want to make light adaptations to the default logger
 * behavior, you would instead call {@link createRootLogger}.
 *
 * @public
 * @deprecated This function will be removed in the future.
 */
export function setRootLogger(newLogger: winston.Logger) {
  rootLogger = newLogger;
}

/**
 * Gets the current root logger.
 *
 * @public
 * @deprecated This function will be removed in the future.
 */
export function getRootLogger(): winston.Logger {
  if (!rootLogger) {
    rootLogger = createRootLogger();
  }
  return rootLogger;
}

/**
 * Creates a default "root" logger. This also calls {@link setRootLogger} under
 * the hood.
 *
 * @remarks
 *
 * This is the logger instance that will be the foundation for all other logger
 * instances passed to plugins etc, in a given backend.
 *
 * @public
 * @deprecated This function will be removed in the future.
 */
export function createRootLogger(
  options: winston.LoggerOptions = {},
  env = process.env,
): winston.Logger {
  const logger = winston
    .createLogger(
      merge<LoggerOptions, LoggerOptions>(
        {
          level: env.LOG_LEVEL || 'info',
          format: winston.format.combine(
            getRedacter().format,
            env.NODE_ENV === 'production'
              ? winston.format.json()
              : WinstonLogger.colorFormat(),
          ),
          transports: [
            new winston.transports.Console({
              silent: env.JEST_WORKER_ID !== undefined && !env.LOG_LEVEL,
            }),
          ],
        },
        options,
      ),
    )
    .child({ service: 'roadie' });

  setRootLogger(logger);

  return logger;
}
