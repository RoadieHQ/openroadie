import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface WizardModule {
  renderWizard(args: string[]): Promise<boolean>;
}

function emit(payload: Record<string, unknown>): void {
  console.log(`JSON: ${JSON.stringify({ command: 'setup', ...payload })}`);
}

async function loadWizard(): Promise<WizardModule> {
  const bundledPaths = [
    resolve(__dirname, 'setup-wizard.mjs'),
    resolve(__dirname, '..', 'dist', 'setup-wizard.mjs'),
  ];
  for (const bundled of bundledPaths) {
    try {
      return (await import(pathToFileURL(bundled).href)) as WizardModule;
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : '';
      const message = error instanceof Error ? error.message : '';
      const missingCandidate =
        (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') &&
        message.includes(bundled);
      if (!missingCandidate) {
        throw error;
      }
    }
  }
  return (await import('./render')) as WizardModule;
}

export async function runSetup(args: string[] = []): Promise<void> {
  try {
    const { renderWizard } = await loadWizard();
    const ran = await renderWizard(args);
    if (!ran) {
      emit({ status: 'exited', exitCode: process.exitCode ?? 1 });
      return;
    }
    emit({ status: 'done', exitCode: 0 });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`openroadie setup: wizard failed: ${reason}`);
    emit({ status: 'failed', reason });
    process.exitCode = 1;
  }
}
