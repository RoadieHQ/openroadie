# roadie-mcp-server

Welcome to the roadie-mcp-serverplugin!

## Getting started

Your plugin has been added to the example app in this repository, meaning you'll be able to access it by running `yarn start` in the root directory, and then navigating to [/roadie-mcp-server](http://localhost:3000/roadie-mcp-server).

You can also serve the plugin in isolation by running `yarn start` in the plugin directory.
This method of serving the plugin provides quicker iteration speed and a faster startup and hot reloads.
It is only meant for local development, and the setup for it can be found inside the [/dev](./dev) directory.

## Workspace isolation

The server resolves and authorizes the workspace on every HTTP request. An
`Mcp-Session-Id` identifies the transport session, but does not bind that
session to a workspace. Audit and telemetry records are therefore stored under
the workspace authorized for the individual request, even when the same
session ID is presented from another workspace.
