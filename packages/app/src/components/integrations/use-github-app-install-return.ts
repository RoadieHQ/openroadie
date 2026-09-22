import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useAlert } from '../../api';

/**
 * Handles the tab that GitHub redirects back to after a GitHub App install /
 * install-request. The install flow (in `GitHubIntegrationDialog`'s `AppSection`)
 * opens GitHub in a new tab whose redirect URL is built from the *current*
 * `origin + pathname` plus `?github-app-installed` / `?github-app-install-requested`
 * and `?close-after=true`. Whichever route mounts on that URL must run this
 * handler to broadcast completion to the opener and close the tab.
 *
 * Because the dialog can now be opened both from the Integrations overview and
 * from the routed `/integrations/:id` editor, the redirect can land on either —
 * so both call this hook. It strips the transient params, notifies via a
 * `BroadcastChannel`, surfaces a toast, refetches, and closes the tab when asked.
 */
export function useGithubAppInstallReturn(refetch: () => void): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const alertApi = useAlert();

  useEffect(() => {
    const installCompleted =
      searchParams.get('github-app-installed') === 'true';
    const installRequested =
      searchParams.get('github-app-install-requested') === 'true';

    if (!installCompleted && !installRequested) {
      return;
    }

    const shouldClose = searchParams.get('close-after') === 'true';

    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('github-app-installed');
        next.delete('github-app-install-requested');
        next.delete('close-after');
        return next;
      },
      { replace: true },
    );

    if (shouldClose) {
      const channel = new BroadcastChannel('github-app-install');
      channel.postMessage({
        type: installCompleted
          ? 'github-app-installed'
          : 'github-app-install-requested',
      });
      channel.close();
    }

    if (installCompleted) {
      alertApi.post({
        message: 'GitHub App installed successfully',
        severity: 'success',
        display: 'transient',
      });
      refetch();
    } else {
      alertApi.post({
        message:
          'An org admin must approve this installation request. You can close this tab; the installation will appear in Roadie once approved.',
        severity: 'info',
      });
      refetch();
    }

    if (shouldClose) {
      setTimeout(() => {
        window.close();
      }, 100);
    }
  }, [alertApi, refetch, searchParams, setSearchParams]);
}
