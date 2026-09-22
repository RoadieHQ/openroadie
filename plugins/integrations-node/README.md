# @roadiehq/integrations-node

This is a node library package that provides shared types and interfaces for the Integrations Backend plugin.

## Purpose

This package exists to allow other backend plugins to consume types and interfaces from the Integrations Backend without violating Backstage's architecture rules about backend plugins importing from each other.

## Contents

- **Types**: `Integration`, `PaginationConfig`, `RequestOptions`, etc.
- **Interfaces**: `IntegrationClient` - Interface for the Integration Client service
- **Service References**: `integrationClientServiceRef` - Service reference for dependency injection

## Usage

To use the Integration Client in another backend plugin:

```typescript
import {
  integrationClientServiceRef,
  IntegrationClient,
  PaginationConfig,
} from '@roadiehq/integrations-node';

// In your plugin registration
export const myPlugin = createBackendPlugin({
  pluginId: 'my-plugin',
  register(env) {
    env.registerInit({
      deps: {
        integrationClient: integrationClientServiceRef,
      },
      async init({ integrationClient }) {
        for await (const page of integrationClient.requestPages(
          'integration-id',
          requestOptions,
        )) {
          // process page.items
        }
      },
    });
  },
});
```

## License

Apache-2.0
