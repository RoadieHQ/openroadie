type VersionSnapshot = {
  name: string;
  version: number;
};

/** Title for create/edit entities that support version history viewing. */
export function resolveVersionedEntityPageTitle({
  isNew,
  newLabel,
  name,
  untitledLabel,
  viewingVersion,
}: {
  isNew: boolean;
  newLabel: string;
  name: string | undefined;
  untitledLabel: string;
  viewingVersion?: VersionSnapshot | null;
}): string {
  if (isNew) {
    return newLabel;
  }
  if (viewingVersion) {
    return `${viewingVersion.name} (v${viewingVersion.version})`;
  }
  return name?.trim() || untitledLabel;
}

/** Title for integration create / edit / duplicate flows. */
export function resolveIntegrationPageTitle({
  isEdit,
  isDuplicate,
  entityName,
}: {
  isEdit: boolean;
  isDuplicate: boolean;
  entityName?: string;
}): string {
  const trimmed = entityName?.trim();
  if (isEdit) {
    return trimmed || 'Edit Integration';
  }
  if (isDuplicate) {
    return trimmed || 'Duplicate Integration';
  }
  return 'New Integration';
}

/** Keeps the header title in sync with a controlled name field while editing. */
export function resolveFormWatchedTitle(
  watchedName: string | undefined,
  pageTitle: string,
): string {
  return watchedName?.trim() || pageTitle;
}

/** Title for context group create / edit. */
export function resolveContextGroupPageTitle(
  isNew: boolean,
  name: string,
): string {
  if (isNew) {
    return 'New Context Group';
  }
  return name.trim() || 'Context Group';
}
