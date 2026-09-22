import PromiseRouter from 'express-promise-router';
import type { Router } from 'express';
import {
  UNATTRIBUTED,
  callerAttribution,
  type HttpAuthService,
  type LoggerService,
} from '@roadiehq/extensions-api';
import { SCOPES, type ScopeService } from '@roadiehq/scopes';
import { getNormalizer, getSupportedHarnesses } from '../normalizers';
import type { SessionTelemetryStore } from '../stores/session-telemetry-store';
import type { WorkspaceService } from '@roadiehq/workspaces-backend';

function stringParam(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createSessionTelemetryRouter({
  store,
  httpAuth,
  logger,
  scopeService,
  workspaceService,
}: {
  store: SessionTelemetryStore;
  httpAuth: HttpAuthService;
  logger: LoggerService;
  scopeService: ScopeService;
  workspaceService: WorkspaceService;
}): Router {
  const router = PromiseRouter();
  const requireScopes = scopeService.requireScopes;

  // Ingestion is write-only and guarded by its own dedicated scope: the token
  // baked into IDE telemetry hooks holds only `mcp-telemetry:create`, so if it
  // leaks it can post events and nothing else. Reads below use `mcp:query`, so
  // a leaked hook token cannot read telemetry back.
  // :hookEvent is optional — harnesses that don't include hook_event_name
  // in the body can put the event name in the URL instead.
  router.post(
    '/:harness/:hookEvent?',
    requireScopes(SCOPES.mcpTelemetry.create),
    async (req, res) => {
      const { harness, hookEvent } = req.params;
      const normalizer = getNormalizer(harness as string);
      if (!normalizer) {
        res.status(400).json({
          error: `Unknown harness: ${harness}. Supported: ${getSupportedHarnesses().join(', ')}`,
        });
        return;
      }

      // Unauthenticated telemetry is allowed — the harness may not have
      // credentials in every hook context — so an unattributable caller
      // records no customer rather than a placeholder one.
      const attribution = await callerAttribution(httpAuth, req);
      const customerId = attribution === UNATTRIBUTED ? undefined : attribution;

      // Inject hook_event_name from the URL when the body doesn't carry it
      const body = hookEvent
        ? { hook_event_name: hookEvent, ...(req.body ?? {}) }
        : (req.body ?? {});

      const event = normalizer.normalize(body);
      if (!event) {
        res.status(204).end();
        return;
      }

      const workspaceId = await workspaceService.resolveWorkspaceId(req);
      try {
        await store.insert(
          {
            ...event,
            harness,
            customerId,
          },
          workspaceId,
        );
      } catch (e: unknown) {
        logger.error('Failed to persist session telemetry event', {
          harness,
          eventType: event.eventType,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      res.status(204).end();
    },
  );

  router.get('/facets', requireScopes(SCOPES.mcp.query), async (req, res) => {
    const workspaceId = await workspaceService.resolveWorkspaceId(req);
    res.json(await store.facets(workspaceId));
  });

  router.get(
    '/sessions/:sessionId',
    requireScopes(SCOPES.mcp.query),
    async (req, res) => {
      const workspaceId = await workspaceService.resolveWorkspaceId(req);
      const events = await store.queryBySession(
        req.params.sessionId as string,
        workspaceId,
      );
      res.json({ items: events });
    },
  );

  router.get('/', requireScopes(SCOPES.mcp.query), async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const workspaceId = await workspaceService.resolveWorkspaceId(req);
    const result = await store.query(
      {
        page: Math.max(0, Number(q.page) || 0),
        pageSize: Math.min(200, Math.max(1, Number(q.pageSize) || 25)),
        harness: stringParam(q.harness),
        sessionId: stringParam(q.sessionId),
        eventType: stringParam(q.eventType),
        customerId: stringParam(q.customerId),
        model: stringParam(q.model),
        from: stringParam(q.from),
        to: stringParam(q.to),
      },
      workspaceId,
    );
    res.json(result);
  });

  return router;
}
