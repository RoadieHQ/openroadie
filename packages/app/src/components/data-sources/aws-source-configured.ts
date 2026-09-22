// The AWS source-configured logic lives in catalog-datastore-common so the
// frontend (editor + list view) and backend (context-group status /
// materialization) share one implementation and cannot drift (sc-33960).
// Re-exported here to keep existing import paths stable.
export {
  hasDynamicAwsAccountSelection,
  isAwsSourceConfigured,
} from '@roadiehq/catalog-datastore-common';
