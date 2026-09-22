import React from 'react';
import {
  ErrorBoundary as ReactErrorBoundary,
  type FallbackProps,
} from 'react-error-boundary';
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router';
import { AlertTriangle, RotateCcw, Copy, Check } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { useCopyToClipboard } from '@roadiehq/ui/copy-button';

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const { copied, copy } = useCopyToClipboard();
  const routeError = isRouteErrorResponse(error) ? error : undefined;
  const caughtError = error instanceof Error ? error : undefined;
  const isNotFound = routeError?.status === 404;
  const message =
    typeof routeError?.data === 'string'
      ? routeError.data
      : (caughtError?.message ??
        routeError?.statusText ??
        'An unknown error occurred');

  const handleCopy = () => {
    void copy([message, caughtError?.stack].filter(Boolean).join('\n\n'));
  };

  return (
    <div className="flex h-full min-h-[400px] w-full items-center justify-center bg-background p-8">
      <div className="w-full max-w-lg space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="size-5 text-destructive" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {isNotFound ? 'Not found' : 'Something went wrong'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isNotFound
                ? 'The requested resource could not be found.'
                : 'An unexpected error occurred while rendering this page.'}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive">{message}</p>
        </div>

        {caughtError?.stack && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
              Error stack trace
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
              {caughtError.stack}
            </pre>
          </details>
        )}

        <div className="flex gap-2 pt-2">
          <Button size="sm" onClick={resetErrorBoundary}>
            <RotateCcw className="size-3.5" />
            Try again
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Reload page
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? (
              <Check className="size-3.5 text-success" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? 'Copied' : 'Copy error'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ReactErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={(error, info) => {
        console.error('[ErrorBoundary]', error, info);
      }}
    >
      {children}
    </ReactErrorBoundary>
  );
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  return (
    <ErrorFallback
      error={error}
      resetErrorBoundary={() => {
        void navigate('.', { replace: true });
      }}
    />
  );
}
