import { z } from 'zod';
import { parse, stringify } from 'yaml';

/**
 *
 * The zod schemas below are the single source of truth: the importer parses
 * with them and the strict item types are inferred from them, so the contract
 * cannot drift between validation and consumption.
 */
/**
 * Format version. The group is a DNS name Roadie controls, following the
 * Kubernetes/Backstage convention so manifests defined by different vendors can
 * never collide.
 *
 * Policy: additive, backward-compatible changes (a new `kind`, a new optional
 * field) keep `v1`; anything that would make an older CLI misread a bundle
 * bumps the version, and `parseBundleDir` refuses a version it does not
 * recognise rather than guessing at it. One asymmetry to respect when making an
 * additive change: zod strips unknown keys, so an older CLI reading a newer
 * `v1` bundle silently drops fields it has no schema for. A new field must
 * therefore never be load-bearing for the correctness of what does import.
 */
export const API_VERSION = 'roadie.io/v1';

export const BUNDLE_KINDS = [
  'DataSource',
  'DirectRelationship',
  'RelationshipRule',
  'ContextGroup',
  'Capability',
  'Action',
  'Integration',
] as const;

export type BundleKind = (typeof BUNDLE_KINDS)[number];

export const KIND_DIRS: Record<BundleKind, string> = {
  DataSource: 'datasources',
  DirectRelationship: 'direct-relationships',
  RelationshipRule: 'relationship-rules',
  ContextGroup: 'context-groups',
  Capability: 'capabilities',
  Action: 'actions',
  Integration: 'integrations',
};

const metadataSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});

const jsonRecord = z.record(z.string(), z.unknown());

const nodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.object({ label: z.string(), config: jsonRecord }),
  width: z.number().optional(),
  height: z.number().optional(),
});

const dataSourceSpecSchema = z.object({
  workflowType: z.string(),
  enabled: z.boolean(),
  viewport: z.unknown().optional(),
  edges: z.array(z.unknown()),
  nodes: z.array(nodeSchema),
  objects: z
    .array(
      z.object({
        objectId: z.string(),
        object: z.unknown(),
      }),
    )
    .optional(),
});

const ruleSpecSchema = z.object({
  sourceDatasourceSlug: z.string().min(1),
  targetDatasourceSlug: z.string().min(1),
  sourceFieldExpression: z.string(),
  targetFieldExpression: z.string(),
  sourceFilterExpression: z.string().optional(),
  targetFilterExpression: z.string().optional(),
  relationshipType: z.string().min(1),
  reciprocalRelationshipType: z.string().optional(),
  strategy: z.string(),
  matchStrategy: z.string(),
  integrationConfig: jsonRecord.optional(),
  state: z.string(),
});

const directRelationshipSpecSchema = z.object({
  sourceDatasourceSlug: z.string().min(1),
  sourceObjectId: z.string().min(1),
  destinationDatasourceSlug: z.string().min(1),
  destinationObjectId: z.string().min(1),
  relationshipType: z.string().min(1),
  reciprocalRelationshipType: z.string().optional(),
  origin: z.string().optional(),
  metadata: jsonRecord.optional(),
});

const groupFilterSchema = z.object({
  datasourceSlug: z.string().min(1),
  filter: z.string().optional(),
  projection: z.unknown().optional(),
  annotation: z.unknown().optional(),
});

const contextGroupSpecSchema = z.object({
  datasources: z.array(groupFilterSchema),
  mergeRelationshipTypes: z.array(z.string()),
  annotations: z.array(z.unknown()),
  includeExternalRelations: z.boolean(),
});

const capabilitySpecSchema = z.object({ instructions: z.string() });

/**
 * No `mode`: the read/write classification is a nullable override column that
 * no API path writes and neither the create nor the update body schema accepts,
 * so it is always derived from the steps (read iff every step is a GET). A
 * `mode` in a manifest could not be applied, and the format must not promise a
 * field it silently drops — the steps carry the classification instead.
 */
const actionSpecSchema = z.object({
  parameters: z.array(z.unknown()),
  steps: z.array(
    z.object({
      id: z.string(),
      integrationSlug: z.string().min(1),
      request: z.unknown(),
    }),
  ),
  enabled: z.boolean(),
});

const integrationSpecSchema = z.object({
  type: z.string().optional(),
  host: z.string().optional(),
  authType: z.string().optional(),
  authConfig: jsonRecord.nullish(),
  backendType: z.string().optional(),
  config: jsonRecord.nullish(),
  graphqlPath: z.string().nullish(),
  requestsPerHour: z.number().nullish(),
  requestsPerSecond: z.number().nullish(),
  burstCapacity: z.number().nullish(),
  logoSlug: z.string().optional(),
});

const itemOf = <K extends BundleKind, S extends z.ZodTypeAny>(
  kind: K,
  spec: S,
) =>
  z.object({
    apiVersion: z.literal(API_VERSION),
    kind: z.literal(kind),
    metadata: metadataSchema,
    spec,
  });

/**
 * Discriminated on `kind`, so a parsed item's `spec` narrows to its kind's
 * shape — the importer needs no casts or re-parsing.
 */
export const bundleItemSchema = z.discriminatedUnion('kind', [
  itemOf('DataSource', dataSourceSpecSchema),
  itemOf('DirectRelationship', directRelationshipSpecSchema),
  itemOf('RelationshipRule', ruleSpecSchema),
  itemOf('ContextGroup', contextGroupSpecSchema),
  itemOf('Capability', capabilitySpecSchema),
  itemOf('Action', actionSpecSchema),
  itemOf('Integration', integrationSpecSchema),
]);

export const bundleManifestSchema = z.object({
  apiVersion: z.literal(API_VERSION),
  name: z.string().min(1),
  description: z.string().optional(),
  prerequisites: z.object({
    integrations: z.array(z.object({ slug: z.string() })),
  }),
});

/**
 * The `apiVersion` a file declares, read without validating anything else. The
 * version gate has to run before schema validation — under an unknown version
 * every field error is noise — so the version must stay readable from a
 * manifest this CLI cannot otherwise parse.
 */
export function declaredApiVersion(raw: unknown): string | undefined {
  const parsed = z.object({ apiVersion: z.string() }).safeParse(raw);
  return parsed.success ? parsed.data.apiVersion : undefined;
}

/** A validated item read from a bundle directory. */
export type BundleItem = z.infer<typeof bundleItemSchema>;
export type BundleManifest = z.infer<typeof bundleManifestSchema>;
/**
 * The bundle-level facts the importer consumes. `apiVersion` is deliberately
 * absent: it is a gate checked once in `parseBundleDir`, not data to carry
 * forward. Carrying it invited synthesising one for a bundle whose own
 * `bundle.yaml` was missing or rejected, which meant the parse result claimed a
 * version the bundle never declared.
 */
export type BundleInfo = Omit<BundleManifest, 'apiVersion'>;
export type ManifestMetadata = z.infer<typeof metadataSchema>;
export type RuleSpec = z.infer<typeof ruleSpecSchema>;
export type GroupFilterSpec = z.infer<typeof groupFilterSchema>;
/** A workflow node as it travels in a bundle (config holds `integrationSlug`). */
export type PortableNode = z.infer<typeof nodeSchema>;

/**
 * The looser shape the exporter *produces*: specs are assembled key-by-key
 * from DB rows, so they are built as plain records and validated on the way
 * back in. `BundleItem` is the strict counterpart.
 */
export interface Manifest {
  apiVersion: string;
  kind: BundleKind;
  metadata: ManifestMetadata;
  spec: Record<string, unknown>;
}

/**
 * Deliberately as permissive as the server's own resolver
 * (`integrationReadiness.ts` collects `${...}` with any body and trims it): a
 * narrower pattern here would miss a legitimate ref such as `${TOKEN_ACME-1}`,
 * and then both the missing-placeholder warning and the "set secret X" guidance
 * would be wrong about an integration that is in fact fine.
 */
const SECRET_REF_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Secret reference names (`${NAME}`) appearing anywhere in a value. Secret
 * *values* never travel in a bundle — only these symbolic names — so they are
 * what the importer must be told to set.
 */
export function secretRefsIn(value: unknown): string[] {
  const found = new Set<string>();
  for (const [, name] of JSON.stringify(value ?? '').matchAll(
    SECRET_REF_PATTERN,
  )) {
    const trimmed = name.trim();
    if (trimmed) {
      found.add(trimmed);
    }
  }
  return [...found].sort();
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toYaml(value: unknown): string {
  return stringify(value, { lineWidth: 0 });
}

export function fromYaml(text: string): unknown {
  return parse(text);
}

/**
 * A manifest file inside a kind directory. The exporter only writes `.yaml`,
 * but both spellings are read so a hand-written `.yml` is not silently ignored
 * (and, being a manifest, is pruned by a re-export like any other).
 */
export function isManifestFile(name: string): boolean {
  return name.endsWith('.yaml') || name.endsWith('.yml');
}

/**
 * Whether a slug can be a manifest filename. Only three of the six kinds have a
 * server-side slug format check, so a slug reaches the exporter unvalidated —
 * and it becomes a path under `--out`. Anything with a separator, or a
 * dot-segment, or nothing usable at all, must not be written.
 */
export function isUsableAsFilename(slug: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(slug) && !/^\.+$/.test(slug);
}

export function manifestPath(kind: BundleKind, slug: string): string {
  if (!isUsableAsFilename(slug)) {
    throw new Error(`slug "${slug}" cannot be used as a filename`);
  }
  return `${KIND_DIRS[`${kind}`]}/${slug}.yaml`;
}

/** Bundle-relative identifier used by the CLI's --only / --exclude flags. */
export function itemKey(item: {
  kind: BundleKind;
  metadata: { slug: string };
}) {
  return `${KIND_DIRS[`${item.kind}`]}/${item.metadata.slug}`;
}
