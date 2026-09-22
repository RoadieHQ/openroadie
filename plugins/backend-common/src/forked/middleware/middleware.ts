import { ConfigReader } from '@roadiehq/config';
import { RequestHandler } from 'express';
import { MiddlewareFactory } from '@roadiehq/backend-defaults';
import { ErrorRequestHandler } from 'express';
import { LoggerService } from '@roadiehq/extensions-api';
import { getRootLogger } from '../logging';

/**
 * Express middleware to handle requests for missing routes.
 *
 * Should be used as the very last handler in the chain, as it unconditionally
 * returns a 404 status.
 *
 * @public
 * @returns An Express request handler
 * @deprecated Use MiddlewareFactory.create().notFound() instead
 */
export function notFoundHandler(): RequestHandler {
  return MiddlewareFactory.create({
    config: new ConfigReader({}),
    logger: getRootLogger(),
  }).notFound();
}

/**
 * Options passed to the {@link errorHandler} middleware.
 *
 * @public
 * @deprecated This type is being deprecated along with the errorHandler function.
 */
export type ErrorHandlerOptions = {
  /**
   * Whether error response bodies should show error stack traces or not.
   *
   * If not specified, by default shows stack traces only in development mode.
   */
  showStackTraces?: boolean;

  /**
   * Logger instance to log errors.
   *
   * If not specified, the root logger will be used.
   */
  logger?: LoggerService;

  /**
   * Whether any 4xx errors should be logged or not.
   *
   * If not specified, default to only logging 5xx errors.
   */
  logClientErrors?: boolean;
};

/**
 * Express middleware to handle errors during request processing.
 *
 * This is commonly the very last middleware in the chain.
 *
 * Its primary purpose is not to do translation of business logic exceptions,
 * but rather to be a global catch-all for uncaught "fatal" errors that are
 * expected to result in a 500 error. However, it also does handle some common
 * error types (such as http-error exceptions) and returns the enclosed status
 * code accordingly.
 *
 * @public
 * @returns An Express error request handler
 * @deprecated Use MiddlewareFactory.create().error() instead
 */
export function errorHandler(
  options: ErrorHandlerOptions = {},
): ErrorRequestHandler {
  return MiddlewareFactory.create({
    config: new ConfigReader({}),
    logger: options.logger ?? getRootLogger(),
  }).error({
    showStackTraces: options.showStackTraces,
  });
}

/**
 * Logs incoming requests.
 *
 * @public
 * @param logger - An optional logger to use. If not specified, the root logger will be used.
 * @returns An Express request handler
 * @deprecated Use MiddlewareFactory.create().logging() instead
 */
export function requestLoggingHandler(logger?: LoggerService): RequestHandler {
  return MiddlewareFactory.create({
    config: new ConfigReader({}),
    logger: logger ?? getRootLogger(),
  }).logging();
}
