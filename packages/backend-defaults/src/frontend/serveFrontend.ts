/*
 * Serve the prebuilt OpenRoadie frontend (SPA) from the same Express process
 * as the backend API, with runtime config injection.
 *
 * This is what makes the standalone `openroadie` distribution serve the full
 * portal (UI + /api) on a single origin. It is only activated when a web
 * directory is provided (env OPENROADIE_WEB_DIR), so the normal split
 * dev/Docker setup — where the frontend is served separately — is unaffected.
 */
import express, { type Express } from 'express';
import { Config } from '@roadiehq/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG_PLACEHOLDER = '<!-- __ROADIE_CONFIG__ -->';

/**
 * Build the SAFE subset of config exposed to the browser. The backend's full
 * config contains secrets (database credentials, auth signing keys, integration
 * tokens) which must NEVER reach the client — so we whitelist explicit keys
 * rather than serialising the whole config.
 *
 * Because the SPA is served same-origin with the API, both `app.baseUrl` and
 * `backend.baseUrl` are emitted as empty strings, which makes the frontend use
 * relative `/api` URLs.
 */
function buildFrontendConfig(config: Config): Record<string, unknown> {
  const str = (key: string) => config.getOptionalString(key);

  const result: Record<string, unknown> = {
    app: {
      title: str('app.title') ?? 'openroadie',
      baseUrl: '',
      ...(str('app.roadieUrl') ? { roadieUrl: str('app.roadieUrl') } : {}),
    },
    backend: { baseUrl: '' },
  };

  const scope = str('scope') ?? str('tenant');
  if (scope) {
    result.scope = scope;
  }

  const organizationName = str('organization.name');
  if (organizationName) {
    result.organization = { name: organizationName };
  }

  const suggestionProducer = str('relations.suggestionProducer');
  if (suggestionProducer) {
    result.relations = { suggestionProducer };
  }

  const features: Record<string, boolean> = {};
  const admin = config.getOptionalBoolean('features.admin');
  if (admin !== undefined) {
    features.admin = admin;
  }
  const relations = config.getOptionalBoolean('features.relations');
  if (relations !== undefined) {
    features.relations = relations;
  }
  if (Object.keys(features).length > 0) {
    result.features = features;
  }

  // Only the public OAuth fields — never secrets.
  const auth = config.getOptionalConfig('auth');
  if (auth) {
    const domain = auth.getOptionalString('domain');
    const clientId = auth.getOptionalString('clientId');
    const audience = auth.getOptionalString('audience');
    const organization = auth.getOptionalString('organization');
    if (domain || clientId || audience) {
      result.auth = {
        ...(domain ? { domain } : {}),
        ...(clientId ? { clientId } : {}),
        ...(audience ? { audience } : {}),
        ...(organization ? { organization } : {}),
      };
    }
  }

  return result;
}

function renderIndexHtml(webDir: string, config: Config): string {
  const indexPath = join(webDir, 'index.html');

  let rawHtml: string;
  try {
    rawHtml = readFileSync(indexPath, 'utf-8');
  } catch {
    throw new Error(
      `serveFrontend: index.html not found in web directory "${webDir}"`,
    );
  }

  const frontendConfig = buildFrontendConfig(config);
  // Escape `<` so a value can't break out of the <script> element.
  const json = JSON.stringify(frontendConfig).replace(/</g, '\\u003c');
  const scriptTag = `<script type="roadie/config">${json}</script>`;

  if (rawHtml.includes(CONFIG_PLACEHOLDER)) {
    return rawHtml.replace(CONFIG_PLACEHOLDER, scriptTag);
  }
  // Fallback if the placeholder was stripped by the build.
  return rawHtml.replace('</head>', `${scriptTag}</head>`);
}

/**
 * Wire up static asset serving + SPA fallback for the frontend.
 *
 * MUST be registered AFTER the plugin routers (`app.use(routes)`) and BEFORE
 * the notFound handler, so that:
 *  - `/api/*` requests reach the plugin routers untouched,
 *  - static assets are served from disk,
 *  - any other GET navigation falls back to the (config-injected) index.html.
 */
export function serveFrontend(
  app: Express,
  config: Config,
  webDir: string,
): void {
  const html = renderIndexHtml(webDir, config);

  // Serve assets from disk, but never auto-serve index.html — we serve the
  // config-injected variant ourselves below.
  app.use(express.static(webDir, { index: false }));

  // SPA fallback: any GET that is not an /api route returns index.html.
  // /readiness is excluded so health probes hit the real endpoint (or 404 on
  // a broken boot) instead of always getting the SPA shell with a 200.
  app.get(/^\/(?!api(?:\/|$)|readiness$).*/, (_req, res) => {
    res.type('html').send(html);
  });
}
