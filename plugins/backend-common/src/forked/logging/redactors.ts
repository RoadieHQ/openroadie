import * as winston from 'winston';
import { WinstonLogger } from '@roadiehq/backend-defaults';

export const getRedacter = (() => {
  let redacter: ReturnType<typeof WinstonLogger.redacter> | undefined =
    undefined;
  return () => {
    if (!redacter) {
      redacter = WinstonLogger.redacter();
    }
    return redacter;
  };
})();

/**
 * A winston formatting function that finds occurrences of filteredKeys
 * and replaces them with the corresponding identifier.
 *
 * @public
 * @deprecated This utility is being deprecated along with the legacy backend system.
 */
export function redactWinstonLogLine(
  info: winston.Logform.TransformableInfo,
): winston.Logform.TransformableInfo {
  return getRedacter().format.transform(
    info,
  ) as winston.Logform.TransformableInfo;
}

export const setRootLoggerRedactionList = (
  redactions: Iterable<string>,
): void => {
  getRedacter().add(redactions);
};
