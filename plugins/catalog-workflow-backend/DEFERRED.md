# Deferred Features (Not in Foundation)

These items are explicitly excluded from Story #30833 (Backend Foundation) and should be added in subsequent stories.

## Data Retention

Log tables (`catalog_workflow_logs`, `catalog_workflow_request_logs`) will grow significantly once scheduling is added. Before going live:

- [ ] Implement truncation job (delete logs older than N days)
- [ ] Or implement archival strategy (move to cold storage)
- [ ] Add database indexes for created_at columns if not present
- [ ] Consider partitioning by date for large deployments

## Database Schema

- [ ] `catalog_workflows.schedule_enabled` - cron scheduling flag
- [ ] `catalog_workflows.schedule_expression` - cron expression
- [ ] `catalog_workflows.retention_mode` - 'mutate' | 'delta' for data ingestion
- [ ] `catalog_workflows.deduplication_key` - field for delta deduplication
- [ ] `catalog_workflows.webhook_enabled` - webhook trigger flag
- [ ] `catalog_workflows.webhook_configs` - JSON array of webhook configs
- [ ] `catalog_workflow_node_executions.schema_metadata` - AI schema analysis
- [ ] `ingested_data` table - stores fetched data from data-ingestion workflows
- [ ] `webhook_deliveries` table - tracks incoming webhook payloads

## DAOs

- [ ] `IngestedDataDao` - CRUD for ingested data with mutate/delta merge logic
- [ ] `WebhookDeliveryDao` - tracks webhook deliveries

## Engine

- [ ] `WebhookEventSubscriber` - subscribes to backend events, triggers webhook executions
- [ ] Edge transforms (JSONata/JMESPath) - data transformation between nodes via edge config

## API

- [ ] `webhookRouter.ts` - handles incoming webhook requests
- [ ] `webhookValidation.ts` - validates GitHub, Slack, generic signatures

## Utils

- [ ] `secureFetch.ts` - SSRF protection (blocks private IPs, metadata endpoints)

## Common Types

- [ ] `permissions.ts` - permission definitions
- [ ] SchemaMetadata types for AI-assisted transformations

## NodeExecutionContext Extensions

- [ ] `storeData()` - store ingested data
- [ ] `getIngestedData()` - retrieve ingested data
- [ ] `detectEntityKind()` - AI entity kind detection
- [ ] `generateEntityMapping()` - AI entity mapping generation
- [ ] `getUpstreamSchema()` - get schema from upstream node
- [ ] `setOutputSchema()` - set schema metadata for output
- [ ] `analyzeSchema()` - analyze data structure
