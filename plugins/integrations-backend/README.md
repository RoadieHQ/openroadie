# Integrations Backend Plugin

This plugin provides a generic HTTP integration system for Backstage, allowing you to configure and manage external API integrations with built-in rate limiting and authentication.

## Authentication

The plugin supports flexible header-based authentication through the `authType` and `authConfig` fields.

### Auth Types

- `header`: Custom header-based authentication (supports multiple headers)
- `none`: No authentication required
