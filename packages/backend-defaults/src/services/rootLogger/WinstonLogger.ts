/*
 * Copyright 2023 The Backstage Authors
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
 * packages/backend-defaults/src/entrypoints/rootLogger/WinstonLogger.ts at v1.47.1, and modified.
 */

import {
  createLogger,
  format,
  transports,
  config as winstonConfig,
} from 'winston';
import type { Format, TransformableInfo } from 'logform';
import type { transport } from 'winston';
import { MESSAGE } from 'triple-beam';
import type { JsonObject, JsonPrimitive } from '../../types';
import type {
  LoggerService,
  RootLoggerService,
} from '@roadiehq/extensions-api';
import { buildOverrideRegExp, buildRedactionRegExp } from './buildRegExp';

/**
 * @public
 */
export type WinstonLoggerLevelOverrideMatchers = {
  [key: string]: JsonPrimitive | JsonPrimitive[] | undefined;
};

/**
 * @public
 */
export type WinstonLoggerLevelOverride = {
  matchers: WinstonLoggerLevelOverrideMatchers;
  level: string;
};

/**
 * @public
 */
export interface WinstonLoggerOptions {
  meta?: JsonObject;
  level?: string;
  format?: Format;
  transports?: transport[];
}

const winstonLevels = winstonConfig.npm.levels;

const parseRegex = (s: string): RegExp | null => {
  if (!s.startsWith('/')) return null;
  const lastSlash = s.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  const pattern = s.slice(1, lastSlash);
  const flags = s.slice(lastSlash + 1);
  try {
    return buildOverrideRegExp(pattern, flags);
  } catch {
    return null;
  }
};

const createLogFieldMatcher = (
  matcher: JsonPrimitive | JsonPrimitive[] | undefined,
): ((logField: unknown) => boolean) => {
  if (Array.isArray(matcher)) {
    const fns = matcher.map(m => createLogFieldMatcher(m));
    return logField => fns.some(fn => fn(logField));
  }
  if (typeof matcher !== 'string') {
    return logField => logField === matcher;
  }
  const regex = parseRegex(matcher);
  if (regex) {
    return logField => typeof logField === 'string' && regex.test(logField);
  }
  return logField => logField === matcher;
};

const createLogMatcher = (
  matchers: WinstonLoggerLevelOverrideMatchers,
): ((log: TransformableInfo) => boolean) => {
  const logFieldMatchers = Object.entries(matchers).map(([key, m]) => {
    const fn = createLogFieldMatcher(m);
    return [key, fn] as const;
  });
  return log => logFieldMatchers.every(([key, fn]) => fn(log[`${key}`]));
};

/**
 * A LoggerService implementation based on winston.
 *
 * @public
 */
export class WinstonLogger implements RootLoggerService {
  #winston: ReturnType<typeof createLogger>;
  #addRedactions?: (redactions: Iterable<string>) => void;
  #setLevelOverrides?: (overrides: WinstonLoggerLevelOverride[]) => void;

  /**
   * Creates a {@link WinstonLogger} instance.
   */
  static create(options: WinstonLoggerOptions): WinstonLogger {
    const defaultLogLevel = process.env.LOG_LEVEL || options.level || 'info';
    const redacter = WinstonLogger.redacter();
    const logLevelFilter = WinstonLogger.logLevelFilter(
      defaultLogLevel as keyof typeof winstonLevels,
    );

    const defaultFormatter =
      process.env.NODE_ENV === 'production'
        ? format.json()
        : WinstonLogger.colorFormat();

    let logger = createLogger({
      level: 'silly',
      format: format.combine(
        logLevelFilter.format,
        options.format ?? defaultFormatter,
        redacter.format,
      ),
      transports: options.transports ?? new transports.Console(),
    });

    if (options.meta) {
      logger = logger.child(options.meta);
    }

    return new WinstonLogger(logger, redacter.add, logLevelFilter.setOverrides);
  }

  /**
   * Creates a winston log formatter for redacting secrets.
   */
  static redacter(): {
    format: Format;
    add: (redactions: Iterable<string>) => void;
  } {
    const redactionSet = new Set<string>();
    let redactionPattern: RegExp | undefined = undefined;

    return {
      format: format((obj: TransformableInfo) => {
        if (!redactionPattern || !obj) {
          return obj;
        }
        const { [MESSAGE]: message } = obj as { [MESSAGE]: unknown };
        if (typeof message !== 'string') {
          return obj;
        }
        return { ...obj, [MESSAGE]: message.replace(redactionPattern, '***') };
      })(),
      add(newRedactions: Iterable<string>) {
        let added = 0;
        for (const redactionToTrim of newRedactions) {
          if (redactionToTrim === null || redactionToTrim === undefined) {
            continue;
          }
          const redaction = redactionToTrim.trim();
          if (redaction.length <= 1) {
            continue;
          }
          if (!redactionSet.has(redaction)) {
            redactionSet.add(redaction);
            added += 1;
          }
        }
        if (added > 0) {
          redactionPattern = buildRedactionRegExp(
            Array.from(redactionSet),
            'g',
          );
        }
      },
    };
  }

  /**
   * Creates a pretty printed winston log formatter.
   */
  static colorFormat(): Format {
    const colorizer = format.colorize();

    return format.combine(
      format.timestamp(),
      format.colorize({
        colors: {
          timestamp: 'dim',
          prefix: 'blue',
          field: 'cyan',
          debug: 'grey',
        },
      }),
      format.printf(info => {
        const { timestamp, level, message, plugin, service, ...fields } = info;
        const prefix = plugin || service;

        const timestampColor = colorizer.colorize(
          'timestamp',
          String(timestamp),
        );
        const prefixColor = colorizer.colorize('prefix', String(prefix));

        const extraFields = Object.entries(fields)
          .map(([key, value]) => {
            let stringValue = '';
            try {
              stringValue = JSON.stringify(value);
            } catch (_e) {
              stringValue = '[field value not castable to string]';
            }
            return `${colorizer.colorize('field', `${key}`)}=${stringValue}`;
          })
          .join(' ');

        return `${timestampColor} ${prefixColor} ${level} ${message} ${extraFields}`;
      }),
    );
  }

  /**
   * Formatter that filters log levels using overrides.
   */
  static logLevelFilter(defaultLogLevel: keyof typeof winstonLevels): {
    format: Format;
    setOverrides: (overrides: WinstonLoggerLevelOverride[]) => void;
  } {
    const overrides: Array<{
      predicate: (log: TransformableInfo) => boolean;
      level: string;
    }> = [];

    return {
      format: format((log: TransformableInfo) => {
        for (const override of overrides) {
          if (override.predicate(log)) {
            if (
              winstonLevels[log.level as keyof typeof winstonLevels] >
              winstonLevels[override.level as keyof typeof winstonLevels]
            ) {
              return false;
            }
            return log;
          }
        }
        if (
          winstonLevels[log.level as keyof typeof winstonLevels] >
          winstonLevels[defaultLogLevel as keyof typeof winstonLevels]
        ) {
          return false;
        }
        return log;
      })(),
      setOverrides: (newOverrides: WinstonLoggerLevelOverride[]) => {
        const newOverridesPredicates = newOverrides.map(o => ({
          predicate: createLogMatcher(o.matchers),
          level: o.level,
        }));
        overrides.splice(0, overrides.length, ...newOverridesPredicates);
      },
    };
  }

  private constructor(
    winston: ReturnType<typeof createLogger>,
    addRedactions?: (redactions: Iterable<string>) => void,
    setLevelOverrides?: (overrides: WinstonLoggerLevelOverride[]) => void,
  ) {
    this.#winston = winston;
    this.#addRedactions = addRedactions;
    this.#setLevelOverrides = setLevelOverrides;
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
    return new WinstonLogger(this.#winston.child(meta));
  }

  addRedactions(redactions: Iterable<string>): void {
    this.#addRedactions?.(redactions);
  }

  setLevelOverrides(overrides: WinstonLoggerLevelOverride[]): void {
    this.#setLevelOverrides?.(overrides);
  }
}
