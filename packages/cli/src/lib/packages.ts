import { getPackages, type Package } from '@manypkg/get-packages';
import { paths } from './paths.js';

export interface PackageInfo {
  name: string;
  dir: string;
  packageJson: Package['packageJson'] & {
    main?: string;
    types?: string;
    exports?: Record<string, unknown>;
    scripts?: Record<string, string>;
    roadie?: {
      role?: string;
      inline?: boolean;
    };
  };
}

export type PackageRole =
  | 'frontend'
  | 'backend'
  | 'common-library'
  | 'web-library'
  | 'node-library'
  | 'frontend-plugin'
  | 'backend-plugin'
  | 'backend-plugin-module'
  | 'cli';

export interface RoleOutput {
  cjs: boolean;
  esm: boolean;
  types: boolean;
}

const ROLE_OUTPUTS: Record<PackageRole, RoleOutput> = {
  frontend: { cjs: false, esm: false, types: false },
  backend: { cjs: false, esm: false, types: false },
  'common-library': { cjs: true, esm: false, types: true },
  'web-library': { cjs: true, esm: true, types: true },
  'node-library': { cjs: true, esm: false, types: true },
  'frontend-plugin': { cjs: true, esm: true, types: true },
  'backend-plugin': { cjs: true, esm: false, types: true },
  'backend-plugin-module': { cjs: true, esm: false, types: true },
  cli: { cjs: true, esm: false, types: false },
};

export function getOutputsForRole(role: PackageRole): RoleOutput {
  return ROLE_OUTPUTS[role] ?? { cjs: true, esm: false, types: true };
}

export function detectRoleFromPackage(
  packageJson: PackageInfo['packageJson'],
): PackageRole | undefined {
  const explicit = packageJson.roadie?.role;
  if (explicit) {
    return explicit as PackageRole;
  }

  const name = packageJson.name;
  if (name.includes('-backend') || name.endsWith('/backend')) {
    if (name.includes('-module')) {
      return 'backend-plugin-module';
    }
    return 'backend-plugin';
  }
  if (name.includes('-common') || name.endsWith('/common')) {
    return 'common-library';
  }
  if (name.includes('-node') || name.endsWith('/node')) {
    return 'node-library';
  }

  return 'common-library';
}

export async function listTargetPackages(): Promise<PackageInfo[]> {
  const { packages } = await getPackages(paths.targetRoot);
  return packages.map(pkg => ({
    name: pkg.packageJson.name,
    dir: pkg.dir,
    packageJson: pkg.packageJson as PackageInfo['packageJson'],
  }));
}

export class PackageGraph extends Map<string, PackageInfo> {
  static async listTargetPackages(): Promise<PackageInfo[]> {
    return listTargetPackages();
  }

  static fromPackages(packages: PackageInfo[]): PackageGraph {
    const graph = new PackageGraph();
    for (const pkg of packages) {
      if (graph.has(pkg.name)) {
        throw new Error(`Duplicate package name '${pkg.name}'`);
      }
      graph.set(pkg.name, pkg);
    }
    return graph;
  }
}
