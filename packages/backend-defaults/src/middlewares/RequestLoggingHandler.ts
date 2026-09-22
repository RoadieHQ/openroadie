import morgan from 'morgan';
import { isError } from '../errors';
import { Config } from '@roadiehq/config';
import { Request } from 'express';
import { LoggerService } from '@roadiehq/extensions-api';

export interface RequestLoggingHandlerOptions {
  logger: LoggerService;
  config: Config;
  /**
   * Optional callback to extract per-request context for logging.
   * Returns key-value pairs that will be included in the log output.
   */
  getContext?: (req: Request) => Record<string, string | undefined> | undefined;
}

export class RequestLoggingHandler {
  private logger: LoggerService;
  private config: Config;
  private getContext?: (
    req: Request,
  ) => Record<string, string | undefined> | undefined;

  constructor({ logger, config, getContext }: RequestLoggingHandlerOptions) {
    this.logger = logger;
    this.config = config;
    this.getContext = getContext;
  }

  handler() {
    const requestLogger = this.logger.child({
      type: 'incomingRequest',
    });
    const handlerLogger = this.logger.child({
      className: 'RequestLoggingHandler',
    });
    const getContext = this.getContext;

    morgan.token('matched-path', (req: Request) => {
      const matchedRoute = req.route ? req.route.path : '';
      return req.baseUrl + matchedRoute;
    });
    morgan.token('roadie-trace-id', (req: Request) => {
      return [req.headers['roadie-trace'] || ''].flat().join(',');
    });
    morgan.token('extra-context', (req: Request) => {
      const ctx = getContext?.(req);
      if (!ctx) return '{}';
      // Escape for embedding inside the outer JSON string value
      return JSON.stringify(ctx).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    });
    morgan.format(
      'json',
      JSON.stringify({
        remote_addr: ':remote-addr',
        remote_user: ':remote-user',
        date_clf: ':date[clf]',
        method: ':method',
        url: ':url',
        http_version: ':http-version',
        status: ':status',
        content_length: ':res[content-length]',
        response_time: ':response-time',
        matched_path: ':matched-path',
        roadie_trace_id: ':roadie-trace-id',
        extra_context: ':extra-context',
      }),
    );
    return morgan('json', {
      stream: {
        write(message: string) {
          let parsedMessage: Record<string, string> | undefined;

          try {
            parsedMessage = JSON.parse(message);
          } catch (e) {
            handlerLogger.info(
              `Failed to parse the request message using json: ${
                isError(e) ? e.message : 'unknown error'
              }`,
            );
          }

          let extraContext: Record<string, string | undefined> | undefined;
          if (parsedMessage?.extra_context) {
            try {
              extraContext = JSON.parse(parsedMessage.extra_context);
              delete parsedMessage.extra_context;
            } catch {
              // ignore parse errors
            }
          }

          requestLogger.info(
            !parsedMessage
              ? message
              : `${parsedMessage.remote_addr} - ${parsedMessage.remote_user} [${parsedMessage.date_clf}] "${parsedMessage.method} ${parsedMessage.url} HTTP/${parsedMessage.http_version}" ${parsedMessage.status} ${parsedMessage.content_length}`,
            {
              ...parsedMessage,
              ...extraContext,
              response_time: Number.parseFloat(
                parsedMessage?.response_time ?? '0',
              ),
            },
          );
        },
      },
    });
  }
}
