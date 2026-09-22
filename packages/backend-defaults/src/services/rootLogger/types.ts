import { JsonObject } from '../../types';

export const winstonLevels: Record<string, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export interface WinstonLoggerLevelOverrideMatchers {
  plugin?: string;
  [key: string]: string | undefined;
}

export interface RootLoggerLevelOverride {
  matchers: WinstonLoggerLevelOverrideMatchers;
  level: string;
}

export interface RootLoggerConfig {
  meta?: JsonObject;
  level?: string;
  overrides?: RootLoggerLevelOverride[];
}
