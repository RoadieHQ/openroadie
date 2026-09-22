import {
  connectIntegration,
  enableIntegration,
  listIntegrations,
} from './bridge';

/**
 * Non-interactive, real check used by `openroadie setup -- --selfcheck`: load
 * the integrations list from the live backend and drive a managed integration
 * through its real connect flow via the in-package bridge. No fabricated state —
 * if the backend is wrong, this fails loudly.
 *
 * The real CLI is stateless (it recomputes readiness from live endpoints on
 * every run), so there is nothing to persist; `openroadie status` reflects the
 * truth the moment connect resolves.
 */
export async function runSelfCheck() {
  const all = await listIntegrations();
  if (all.length === 0) {
    console.error('Selfcheck failed: openroadie returned no integrations.');
    process.exitCode = 1;
    return;
  }

  // Prefer a managed integration that genuinely auto-connects (e.g. kubernetes)
  // over a `none` integration that actually needs an app install (github). Both
  // report `authType: none`; only the connect call reveals the difference, so we
  // exclude the known app-install ids here to keep the smoke test a clean signal.
  const APP_INSTALL_IDS = new Set([
    'github',
    'github-app',
    'github-enterprise',
  ]);
  const managedCandidates = all.filter(item => item.authType === 'none');
  const managed =
    managedCandidates.find(item => !APP_INSTALL_IDS.has(item.id)) ??
    managedCandidates[0];
  if (!managed) {
    console.log(
      `Selfcheck: loaded ${all.length} integrations from the CLI (no managed integration to connect).`,
    );
    return;
  }

  try {
    await enableIntegration(managed.id);
    const result = await connectIntegration(managed.id);
    const verdict = result.connected
      ? 'connected'
      : `pending (${result.needs ?? result.status})`;
    console.log(
      `Selfcheck: ${all.length} integrations from CLI; ${managed.id} → ${verdict}.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Selfcheck failed driving ${managed.id}: ${message}`);
    process.exitCode = 1;
  }
}
