import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  API_VERSION,
  bundleItemSchema,
  bundleManifestSchema,
  declaredApiVersion,
  fromYaml,
  isManifestFile,
  itemKey,
  KIND_DIRS,
  type BundleInfo,
  type BundleItem,
} from './format';
import { bundleIdentity, describeIdentity } from './import-plan';

export interface ParsedBundle {
  manifest: BundleInfo;
  items: BundleItem[];
  errors: Array<{ file: string; message: string }>;
  /**
   * Set when the bundle as a whole cannot be read — today, only a format
   * version this CLI does not recognise. Distinct from `errors`, which are
   * per-file and leave the rest of the bundle importable.
   */
  fatal?: string;
}

function issueSummary(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
}

/**
 * Read a bundle directory into validated items. Every file is parsed
 * independently: one malformed manifest is an error entry, never a thrown
 * exception, so the importer can report all problems in one pass.
 */
export async function parseBundleDir(dir: string): Promise<ParsedBundle> {
  const errors: ParsedBundle['errors'] = [];
  const items: BundleItem[] = [];
  /** Identity → the file that claimed it, so a duplicate can name the other. */
  const identityFile = new Map<string, string>();
  /**
   * `<kind-dir>/<slug>` → the file that claimed it. Distinct from the identity
   * above for relationship rules only, whose identity is their tuple: two rule
   * files can carry different tuples under one slug, and that key is what
   * `--only`/`--exclude` address and what the apply pass looks a plan action up
   * by — so a shared one would apply one item's decision to both.
   */
  const keyFile = new Map<string, string>();

  let manifest: BundleInfo = { name: dir, prerequisites: { integrations: [] } };
  let raw: unknown;
  try {
    raw = fromYaml(await readFile(join(dir, 'bundle.yaml'), 'utf8'));
  } catch (e: unknown) {
    errors.push({
      file: 'bundle.yaml',
      message: e instanceof Error ? e.message : String(e),
    });
  }

  // The version gate runs before anything else is parsed. An unrecognised
  // format version is a property of the whole bundle, not of each file: parsing
  // items under it reports their fields as malformed (noise that buries the real
  // cause) and imports whichever ones happen to still validate, which wrote
  // pieces of a bundle this CLI had already declared it could not read.
  const declared = declaredApiVersion(raw);
  if (declared !== undefined && declared !== API_VERSION) {
    return {
      manifest,
      items: [],
      errors: [],
      // Deliberately not "upgrade the CLI": the bundle can be either older or
      // newer than this CLI, and the first real skew in the wild is the older
      // direction (bundles predating the v1 group). Name both and let the
      // operator pick the end to move.
      fatal: `bundle.yaml declares apiVersion "${declared}" but this openroadie CLI understands "${API_VERSION}" — re-export the bundle with this CLI, or use a CLI that supports "${declared}"`,
    };
  }

  if (raw !== undefined) {
    const parsed = bundleManifestSchema.safeParse(raw);
    if (parsed.success) {
      const { apiVersion: _apiVersion, ...info } = parsed.data;
      manifest = info;
    } else {
      errors.push({ file: 'bundle.yaml', message: issueSummary(parsed.error) });
    }
  }

  for (const kindDir of Object.values(KIND_DIRS)) {
    let names: string[];
    try {
      names = await readdir(join(dir, kindDir));
    } catch {
      continue; // kind directory absent — fine
    }
    // `.yml` too: the exporter only writes `.yaml`, but a hand-written manifest
    // using the other spelling was previously neither imported nor reported.
    for (const name of names.filter(isManifestFile).sort()) {
      const file = `${kindDir}/${name}`;
      try {
        const raw = fromYaml(await readFile(join(dir, file), 'utf8'));
        const parsed = bundleItemSchema.safeParse(raw);
        if (!parsed.success) {
          errors.push({ file, message: issueSummary(parsed.error) });
          continue;
        }
        const item = parsed.data;
        // Two files claiming one identity would both apply and collide
        // server-side; reject the later one with a readable reason instead.
        const identity = bundleIdentity(item);
        const claimedBy = identityFile.get(identity);
        if (claimedBy) {
          errors.push({
            file,
            message: `${describeIdentity(item)} (already declared in ${claimedBy})`,
          });
          continue;
        }
        const key = itemKey(item);
        const keyClaimedBy = keyFile.get(key);
        if (keyClaimedBy) {
          errors.push({
            file,
            message: `duplicate ${item.kind} slug "${item.metadata.slug}" (already declared in ${keyClaimedBy})`,
          });
          continue;
        }
        identityFile.set(identity, file);
        keyFile.set(key, file);
        items.push(item);
      } catch (e: unknown) {
        errors.push({
          file,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  return { manifest, items, errors };
}
