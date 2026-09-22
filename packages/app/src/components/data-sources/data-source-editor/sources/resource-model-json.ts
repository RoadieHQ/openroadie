// The resource-model JSON validator lives in catalog-datastore-common so the
// frontend and backend share one implementation. Re-exported here to keep
// existing import paths stable.
export { getResourceModelJsonError } from '@roadiehq/catalog-datastore-common';
