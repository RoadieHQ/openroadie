import type {
  CliIntegration,
  ConnectResult,
  IntegrationAuthType,
} from './bridge';

export type AuthType = IntegrationAuthType;
export type Integration = CliIntegration;

export type Connection = {
  connected: boolean;
  authType: AuthType;
  credential: 'managed' | 'user-secret' | 'oauth-approved';
};

export type FooterHint = {
  key: string;
  label: string;
};

export type Stage = 'Welcome' | 'Integrations' | 'Connect' | 'Handoff';

// Drive-phase for the currently-focused integration. Each phase reflects a real
// CLI call (or what the last call told us to do next).
export type ConnectPhase =
  | 'working' // enable + connect (or re-connect) in flight
  | 'needs-host' // unconfigured instance integrations need host before auth refs exist
  | 'needs-token' // CLI reported needs:user-secret → prompt + secret set
  | 'app-setup' // GitHub App setup happens in the browser → Enter re-checks with --confirm
  | 'manual' // pending on something that may become true (e.g. ambient creds) → Enter re-checks
  | 'error'; // a CLI call threw — show the message

export type ConnectView = {
  phase: ConnectPhase;
  secretName: string | null;
  secretNames: string[];
  secretIndex: number;
  message: string | null;
  appSetupUrl: string | null;
  appSetupOpened: boolean;
};

export const INITIAL_VIEW: ConnectView = {
  phase: 'working',
  secretName: null,
  secretNames: [],
  secretIndex: 0,
  message: null,
  appSetupUrl: null,
  appSetupOpened: false,
};

// `needs` values that require creating/installing a GitHub App in the browser.
// The wizard can help by opening the app page and re-checking with --confirm.
const GITHUB_APP_SETUP_NEEDS = new Set(['github-app-install', 'github-app']);

export const stages: Stage[] = [
  'Welcome',
  'Integrations',
  'Connect',
  'Handoff',
];

// The left-menu steps: only the stages the user actually *does*. Welcome (intro)
// and Handoff (exit) are screens, not setup steps, so they're omitted from the
// stepper. Each entry maps back to its index in `stages` for marker state.
export const menuStages: Stage[] = ['Integrations', 'Connect'];

export const defaultIds = new Set<string>();

export function viewFromConnect(result: ConnectResult): ConnectView {
  if (result.needs === 'host') {
    return { ...INITIAL_VIEW, phase: 'needs-host', message: result.reason };
  }
  if (result.needs === 'user-secret' && result.secretName) {
    return {
      ...INITIAL_VIEW,
      phase: 'needs-token',
      secretName: result.secretName,
      secretNames:
        result.secretNames?.length > 0
          ? result.secretNames
          : [result.secretName],
      message: result.reason,
    };
  }
  if (result.needs && GITHUB_APP_SETUP_NEEDS.has(result.needs)) {
    return { ...INITIAL_VIEW, phase: 'app-setup', message: result.reason };
  }
  // Anything still pending without a resolvable next step (e.g. an ambient-auth
  // integration whose credentials aren't reachable yet). Re-checking can succeed
  // once the environment is ready, so this stays retryable.
  return {
    ...INITIAL_VIEW,
    phase: 'manual',
    message:
      result.reason ?? `Not connected yet (${result.needs ?? result.status}).`,
  };
}
