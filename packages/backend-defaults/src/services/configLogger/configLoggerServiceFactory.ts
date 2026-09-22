import {
  createServiceFactory,
  createServiceRef,
  LoggerService,
} from '@roadiehq/extensions-api';
import { JsonObject } from '../../types';
import { createLogger, format, transports, Logger } from 'winston';

/**
 * A simple standalone logger service for use during config loading.
 * Does not depend on rootLogger or rootConfig, breaking the circular dependency.
 */
export const configLoggerServiceRef = createServiceRef<LoggerService>({
  id: 'roadie.configLogger',
  scope: 'root',
});

class ConfigLogger implements LoggerService {
  #winston: Logger;

  constructor(winston: Logger) {
    this.#winston = winston;
  }

  error(message: string, meta?: JsonObject): void {
    this.#winston.error(message, meta);
  }

  warn(message: string, meta?: JsonObject): void {
    this.#winston.warn(message, meta);
  }

  info(message: string, meta?: JsonObject): void {
    this.#winston.info(message, meta);
  }

  debug(message: string, meta?: JsonObject): void {
    this.#winston.debug(message, meta);
  }

  child(meta: JsonObject): LoggerService {
    return new ConfigLogger(this.#winston.child(meta));
  }
}

export const configLoggerServiceFactory = createServiceFactory({
  service: configLoggerServiceRef,
  deps: {},
  async factory() {
    const logger = createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: process.env.DEV_MODE
        ? format.combine(format.colorize(), format.simple())
        : format.combine(
            format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
            format.json(),
          ),
      defaultMeta: { service: 'config-loader' },
      transports: [new transports.Console()],
    });

    return new ConfigLogger(logger);
  },
});
