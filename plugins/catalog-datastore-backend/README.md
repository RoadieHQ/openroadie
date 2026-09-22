# Catalog Datastore Backend

A backend plugin that provides a general-purpose datastore for ingesting, indexing, searching, and relating arbitrary JSON objects across datasources.

## API

Base path: `/api/catalog-datastore`

### Objects

| Method   | Path                               | Description                                                             |
| -------- | ---------------------------------- | ----------------------------------------------------------------------- |
| `GET`    | `/objects/:datasourceId`           | List objects for a datasource (supports pagination, filtering, sorting) |
| `POST`   | `/objects/:datasourceId`           | Add a single object                                                     |
| `PUT`    | `/objects/:datasourceId`           | Replace all objects for a datasource (bulk upsert)                      |
| `DELETE` | `/objects/:datasourceId`           | Delete all objects for a datasource                                     |
| `GET`    | `/objects/:datasourceId/:objectId` | Get a specific object (includes relationships)                          |
| `DELETE` | `/objects/:datasourceId/:objectId` | Delete a specific object                                                |

### Search

| Method | Path                                                | Description                         |
| ------ | --------------------------------------------------- | ----------------------------------- |
| `GET`  | `/search?q=&datasourceIds=&limit=&offset=&explain=` | Full-text search across all objects |

### Schemas

Schemas are automatically inferred from ingested objects.

| Method | Path                            | Description                               |
| ------ | ------------------------------- | ----------------------------------------- |
| `GET`  | `/schemas/`                     | List all datasource schemas               |
| `GET`  | `/schemas/:datasourceId/latest` | Get latest schema for a datasource        |
| `GET`  | `/schemas/:datasourceId`        | List all schema versions for a datasource |

### Relationships

Directed edges between objects that form a knowledge graph.

| Method   | Path                                                 | Description                                       |
| -------- | ---------------------------------------------------- | ------------------------------------------------- |
| `PUT`    | `/relationships/`                                    | Create or upsert a single relationship            |
| `PUT`    | `/relationships/bulk`                                | Bulk upsert multiple relationships                |
| `GET`    | `/relationships/:id`                                 | Get a relationship by ID                          |
| `DELETE` | `/relationships/:id`                                 | Delete a relationship by ID                       |
| `GET`    | `/relationships/types/:datasourceId`                 | List distinct relationship types for a datasource |
| `GET`    | `/relationships/source/:datasourceId/:objectId`      | Get outgoing relationships from an object         |
| `DELETE` | `/relationships/source/:datasourceId/:objectId`      | Delete all outgoing relationships from an object  |
| `GET`    | `/relationships/destination/:datasourceId/:objectId` | Get incoming relationships to an object           |
| `DELETE` | `/relationships/destination/:datasourceId/:objectId` | Delete all incoming relationships to an object    |

### Index Configuration

Indexes use JSONata expressions to extract searchable/filterable values from objects.

| Method   | Path                          | Description                           |
| -------- | ----------------------------- | ------------------------------------- |
| `GET`    | `/indexes/:datasourceId`      | List index configurations             |
| `POST`   | `/indexes/:datasourceId`      | Create an index configuration         |
| `DELETE` | `/indexes/:datasourceId`      | Delete all index configurations       |
| `GET`    | `/indexes/:datasourceId/:key` | Get a specific index configuration    |
| `DELETE` | `/indexes/:datasourceId/:key` | Delete a specific index configuration |

## Data Model

**Object** — An arbitrary JSON document identified by a `(datasourceId, objectId)` pair.

**Schema** — Automatically inferred from ingested objects. Versioned per datasource with monotonic version numbers; unchanged schemas are deduplicated by content hash.

**Relationship** — A directed edge between two objects with a `relationshipType`. Unique constraint on `(source, relationshipType, destination)`.

**Index** — A computed key-value pair extracted from an object via a JSONata expression. Populated automatically on insert.

## Installation

```typescript
// packages/backend/src/index.ts
backend.add(import('@roadiehq/catalog-datastore-backend'));
```

### Webhook authentication

Public and shared-secret verifier modes authorize the default workspace only.
Webhook delivery for other workspaces requires DB-backed workspace tokens.

### Relationship Suggestions

Relationship suggestions are produced by the datastore backend's deterministic
scorer.
