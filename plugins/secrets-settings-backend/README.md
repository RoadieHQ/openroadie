# Secrets Settings backend plugin

This plugin serves as the backend for the secrets-settings frontend plugin.

## Installation

Add this package as a dependency to your backend, for example

```bash
yarn add @roadiehq/plugin-secrets-settings-backend
```

By adding the app package as a dependency we ensure that it is built as part of the backend, and that it can be resolved at runtime.

Now add the plugin router to your app, creating it for example like this:

```ts
const router = await createRouter({
  logger,
  appPackageName: 'example-app',
});
```

And register it like this:

```ts
export default async function createPlugin({
  logger,
  config,
}: PluginEnvironment) {
  return await createRouter({
    logger,
    config,
    appPackageName: 'secrets-settings',
  });
}
```

## Local Development

To develop locally you can use `yarn link` (https://classic.yarnpkg.com/en/docs/cli/link/) to link this repository to
your local Roadie backend.

- In this repo `yarn link`
- _At the root_ of your Roadie repo `yarn link @roadiehq/secrets-settings-backend`
- Ensure you build your code `yarn tsc && yarn build && yarn pack`
- Start/restart the backend

NB: yarn link must be run _from the root_ not from the backend package dir as this is where the
node_modules directory is.
