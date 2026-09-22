import { FullConfig } from '@playwright/test';

/**
 * Global setup for E2E tests
 * This runs once before all tests
 */
async function globalSetup(_config: FullConfig) {
  const maxRetries = 30;
  const retryInterval = 1000;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch('http://localhost:7008/readiness');
      if (response.ok) {
        console.log('Backend is ready');
        return;
      }
    } catch {
      // Backend not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, retryInterval));
  }

  throw new Error('Backend did not become ready in time');
}

export default globalSetup;
