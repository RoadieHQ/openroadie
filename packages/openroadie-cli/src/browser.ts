import { spawn } from 'node:child_process';

export type BrowserOpenResult = {
  url: string;
  opened: boolean;
  command: string | null;
  args: string[];
};

type SpawnedBrowser = {
  unref: () => void;
  on?: (event: 'error', listener: (error: Error) => void) => SpawnedBrowser;
};

export type SpawnBrowser = (
  command: string,
  args: string[],
  options: { detached: true; stdio: 'ignore' },
) => SpawnedBrowser;

function openerForPlatform(
  platform: NodeJS.Platform,
  url: string,
): { command: string; args: string[] } | null {
  switch (platform) {
    case 'darwin':
      return { command: 'open', args: [url] };
    case 'linux':
      return { command: 'xdg-open', args: [url] };
    case 'win32':
      return { command: 'cmd', args: ['/c', 'start', '', url] };
    default:
      return null;
  }
}

/**
 * Open a URL in the user's default browser, detached and non-blocking. Returns
 * the URL (always, for a manual fallback) plus whether an opener was spawned. On
 * an unknown platform or a spawn failure, `opened` is false and the caller
 * should print the URL for the user to open by hand.
 */
export function openUrl(
  url: string,
  spawnBrowser: SpawnBrowser = spawn,
  platform: NodeJS.Platform = process.platform,
): BrowserOpenResult {
  const opener = openerForPlatform(platform, url);
  if (!opener) {
    return { url, opened: false, command: null, args: [] };
  }
  try {
    const child = spawnBrowser(opener.command, opener.args, {
      detached: true,
      stdio: 'ignore',
    });
    child.on?.('error', () => {});
    child.unref();
    return { url, opened: true, command: opener.command, args: opener.args };
  } catch {
    return { url, opened: false, command: opener.command, args: opener.args };
  }
}
