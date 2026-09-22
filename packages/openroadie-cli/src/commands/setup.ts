interface SetupModule {
  runSetup(args: string[]): Promise<void>;
}

async function loadSetup(): Promise<SetupModule> {
  try {
    const builtSetup = '@roadiehq/openroadie-setup/dist/index.cjs.js';
    return (await import(builtSetup)) as SetupModule;
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : '';
    if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
    return (await import('@roadiehq/openroadie-setup')) as SetupModule;
  }
}

export async function runSetup(args: string[] = []): Promise<void> {
  const setup = await loadSetup();
  await setup.runSetup(args);
}
