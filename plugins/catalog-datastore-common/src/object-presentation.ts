export type ObjectPresentationPurpose =
  | 'column'
  | 'title'
  | 'subtitle'
  | 'image';

export interface ObjectPresentation {
  title: string;
  subtitle?: string;
  image?: string;
}

export const OBJECT_PRESENTATION_INDEX_KEYS = {
  title: 'presentation.title',
  subtitle: 'presentation.subtitle',
  image: 'presentation.image',
} as const satisfies Record<
  Exclude<ObjectPresentationPurpose, 'column'>,
  string
>;

const TITLE_PATHS = [
  ['name'],
  ['title'],
  ['displayName'],
  ['display_name'],
  ['full_name'],
  ['fullName'],
  ['profile', 'name'],
  ['profile', 'displayName'],
  ['profile', 'display_name'],
  ['real_name'],
  ['profile', 'real_name'],
  ['email'],
  ['mail'],
  ['emailAddress'],
  ['primaryEmail'],
  ['userPrincipalName'],
  ['profile', 'email'],
  ['profile', 'email_address'],
  ['login'],
  ['username'],
  ['label'],
  ['summary'],
  ['fields', 'summary'],
  ['description'],
  ['metadata', 'name'],
  ['key'],
  ['identifier'],
  ['slug'],
  ['path_with_namespace'],
  ['repo'],
] as const;

const INFRASTRUCTURE_TITLE_PATHS = [
  ['metadata', 'name'],
  ['metadata', 'labels', 'app.kubernetes.io/name'],
  ['metadata', 'labels', 'app'],
  ['metadata', 'generateName'],
  ['spec', 'template', 'metadata', 'labels', 'app.kubernetes.io/name'],
  ['spec', 'template', 'metadata', 'labels', 'app'],
  ['resourceName'],
  ['resource_name'],
  ['repositoryName'],
  ['bucketName'],
  ['queueName'],
  ['topicName'],
  ['tableName'],
  ['clusterName'],
  ['serviceName'],
  ['functionName'],
  ['streamName'],
  ['dbInstanceIdentifier'],
  ['dbClusterIdentifier'],
  ['loadBalancerName'],
  ['autoScalingGroupName'],
  ['instanceId'],
  ['properties', 'name'],
  ['properties', 'resourceName'],
  ['properties', 'resource_name'],
  ['properties', 'repositoryName'],
  ['properties', 'bucketName'],
  ['properties', 'queueName'],
  ['properties', 'topicName'],
  ['properties', 'tableName'],
  ['properties', 'clusterName'],
  ['properties', 'serviceName'],
  ['properties', 'functionName'],
  ['properties', 'streamName'],
  ['properties', 'dbInstanceIdentifier'],
  ['properties', 'dbClusterIdentifier'],
  ['properties', 'loadBalancerName'],
  ['properties', 'autoScalingGroupName'],
  ['properties', 'instanceId'],
] as const;

const SUBTITLE_PATHS = [
  ['email'],
  ['mail'],
  ['emailAddress'],
  ['primaryEmail'],
  ['userPrincipalName'],
  ['profile', 'email'],
  ['profile', 'email_address'],
  ['type'],
  ['kind'],
  ['entityType'],
  ['entity_type'],
  ['resourceType'],
  ['resource_type'],
  ['accountType'],
  ['status'],
  ['state'],
  ['state', 'name'],
  ['severity'],
  ['role'],
  ['key'],
  ['identifier'],
  ['slug'],
  ['path_with_namespace'],
  ['metadata', 'namespace'],
  ['namespace'],
] as const;

const IMAGE_PATHS = [
  ['avatar_url'],
  ['avatarUrl'],
  ['profile', 'avatar_url'],
  ['profile', 'avatarUrl'],
  ['image'],
  ['imageUrl'],
  ['picture'],
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function valueForSegment(
  record: Record<string, unknown>,
  segment: string,
): unknown {
  if (segment in record) {
    return record[segment];
  }

  const lowercaseSegment = segment.toLowerCase();
  const matchingKey = Object.keys(record).find(
    key => key.toLowerCase() === lowercaseSegment,
  );
  return matchingKey ? record[matchingKey] : undefined;
}

function rawValueAtPath(objectJson: unknown, path: readonly string[]): unknown {
  let current = objectJson;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = valueForSegment(current, segment);
  }
  return current;
}

function valueAtPath(
  objectJson: unknown,
  path: readonly string[],
): string | undefined {
  const current = rawValueAtPath(objectJson, path);
  return nonEmptyString(current);
}

function firstPathValue(
  objectJson: unknown,
  paths: readonly (readonly string[])[],
): string | undefined {
  for (const path of paths) {
    const value = valueAtPath(objectJson, path);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function inferNameFromArn(value: unknown): string | undefined {
  const arn = nonEmptyString(value);
  if (!arn || !arn.startsWith('arn:')) {
    return undefined;
  }
  const resource = arn.split(':').slice(5).join(':');
  const segments = resource.split(/[/:]/).filter(Boolean);
  return segments.at(-1);
}

function inferInfrastructureTitle(objectJson: unknown): string | undefined {
  const fromPaths = firstPathValue(objectJson, INFRASTRUCTURE_TITLE_PATHS);
  if (fromPaths) {
    return fromPaths;
  }
  return (
    inferNameFromArn(rawValueAtPath(objectJson, ['arn'])) ??
    inferNameFromArn(rawValueAtPath(objectJson, ['properties', 'arn']))
  );
}

function humanizeFieldSegment(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
}

function humanizeFieldPath(path: readonly string[]): string {
  const segment = path.at(-1);
  return segment ? humanizeFieldSegment(segment) : '';
}

function discoverStringFieldPath(
  objectJson: unknown,
  value: string,
  path: string[] = [],
  maxDepth = 6,
): string[] | undefined {
  if (path.length > maxDepth) {
    return undefined;
  }
  if (isRecord(objectJson)) {
    for (const [key, child] of Object.entries(objectJson)) {
      const nextPath = [...path, key];
      if (nonEmptyString(child) === value) {
        return nextPath;
      }
      const nested = discoverStringFieldPath(child, value, nextPath, maxDepth);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

export function resolvePresentationFieldName(
  objectJson: unknown,
  value: string | undefined,
  purpose: 'title' | 'subtitle',
): string | undefined {
  if (!value) {
    return undefined;
  }

  const paths = purpose === 'title' ? TITLE_PATHS : SUBTITLE_PATHS;
  for (const path of paths) {
    if (valueAtPath(objectJson, path) === value) {
      return humanizeFieldPath(path);
    }
  }

  const discovered = discoverStringFieldPath(objectJson, value);
  return discovered ? humanizeFieldPath(discovered) : undefined;
}

export function resolveObjectPresentation(
  objectJson: unknown,
  objectId: string,
  configured: Partial<ObjectPresentation> = {},
): ObjectPresentation {
  const title =
    nonEmptyString(configured.title) ??
    firstPathValue(objectJson, TITLE_PATHS) ??
    inferInfrastructureTitle(objectJson) ??
    objectId;
  const subtitle =
    nonEmptyString(configured.subtitle) ??
    firstPathValue(objectJson, SUBTITLE_PATHS);
  const image =
    nonEmptyString(configured.image) ?? firstPathValue(objectJson, IMAGE_PATHS);
  return {
    title,
    ...(subtitle && subtitle !== title ? { subtitle } : {}),
    ...(image ? { image } : {}),
  };
}
