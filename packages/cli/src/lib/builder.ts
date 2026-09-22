import {
  rollup,
  type RollupOptions,
  type OutputOptions,
  type Plugin,
} from 'rollup';
import { resolve as resolvePath, relative, extname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PluginFn = (...args: any[]) => Plugin;

const resolve: PluginFn = require('@rollup/plugin-node-resolve').default;
const commonjs: PluginFn = require('@rollup/plugin-commonjs').default;
const json: PluginFn = require('@rollup/plugin-json').default;
const yaml: PluginFn = require('@rollup/plugin-yaml').default;
const postcss: PluginFn = require('rollup-plugin-postcss');
const esbuild: PluginFn = require('rollup-plugin-esbuild').default;
const dts: PluginFn = require('rollup-plugin-dts').default;
const svgr: PluginFn = require('@svgr/rollup');
import fs from 'fs-extra';
import chalk from 'chalk';
import { paths } from './paths.js';
import {
  type PackageInfo,
  type RoleOutput,
  getOutputsForRole,
  detectRoleFromPackage,
} from './packages.js';

const SCRIPT_EXTS = ['.js', '.jsx', '.ts', '.tsx'];

export interface BuildOptions {
  targetDir: string;
  packageJson: PackageInfo['packageJson'];
  outputs: RoleOutput;
  minify?: boolean;
  logPrefix?: string;
}

interface EntryPoint {
  name: string;
  path: string;
  ext: string;
}

function readEntryPoints(
  packageJson: PackageInfo['packageJson'],
): EntryPoint[] {
  const entryPoints: EntryPoint[] = [];

  const mainEntry = packageJson.main || 'src/index.ts';
  const mainPath = mainEntry.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
  entryPoints.push({
    name: 'index',
    path: mainPath,
    ext: extname(mainPath),
  });

  const exports = packageJson.exports as Record<string, unknown> | undefined;
  if (exports && typeof exports === 'object') {
    for (const [key, value] of Object.entries(exports)) {
      if (key === '.' || key === './package.json') continue;

      const exportPath =
        typeof value === 'string'
          ? value
          : (value as Record<string, string>)?.default;
      if (!exportPath) continue;

      const srcPath = exportPath
        .replace(/^\.\/dist\//, 'src/')
        .replace(/\.js$/, '.ts');
      const name = key.replace(/^\.\//, '');
      entryPoints.push({
        name,
        path: srcPath,
        ext: extname(srcPath),
      });
    }
  }

  return entryPoints;
}

function formatErrorMessage(
  error: Error & {
    code?: string;
    plugin?: string;
    id?: string;
    errors?: Array<{
      text: string;
      location: { line: number; column: number };
    }>;
    loc?: { file?: string; line: number; column: number };
    url?: string;
    frame?: string;
  },
): string {
  let msg = '';

  if (error.code === 'PLUGIN_ERROR') {
    if (error.plugin === 'esbuild' && error.errors?.length) {
      msg += `${error.message}\n\n`;
      for (const { text, location } of error.errors) {
        const { line, column } = location;
        const path = relative(paths.targetDir, error.id || '');
        const loc = chalk.cyan(`${path}:${line}:${column}`);
        if (text === 'Unexpected "<"' && error.id?.endsWith('.js')) {
          msg += `${loc}: ${text}, JavaScript files with JSX should use a .jsx extension`;
        } else {
          msg += `${loc}: ${text}`;
        }
      }
    } else {
      msg += `(plugin ${error.plugin}) ${error}\n`;
    }
  } else {
    if (error.loc) {
      const file = paths.resolveTarget(error.loc.file || error.id || '');
      const pos = `${error.loc.line}:${error.loc.column}`;
      msg += `${file} [${pos}]\n`;
    } else if (error.id) {
      msg += `${paths.resolveTarget(error.id)}\n`;
    }
    msg += `${error}\n`;
    if (error.url) {
      msg += `${chalk.cyan(error.url)}\n`;
    }
    if (error.frame) {
      msg += `${chalk.dim(error.frame)}\n`;
    }
  }

  return msg;
}

async function rollupBuild(config: RollupOptions): Promise<void> {
  try {
    const bundle = await rollup(config);
    if (config.output) {
      const outputs = Array.isArray(config.output)
        ? config.output
        : [config.output];
      for (const output of outputs) {
        await bundle.generate(output);
        await bundle.write(output);
      }
    }
    await bundle.close();
  } catch (error) {
    throw new Error(formatErrorMessage(error as Error));
  }
}

export async function makeRollupConfigs(
  options: BuildOptions,
): Promise<RollupOptions[]> {
  const configs: RollupOptions[] = [];
  const { targetDir, packageJson, outputs, minify } = options;

  const onwarn = ({ code, message }: { code?: string; message: string }) => {
    if (code === 'EMPTY_BUNDLE') return;
    if (options.logPrefix) {
      console.log(options.logPrefix + message);
    } else {
      console.log(message);
    }
  };

  const distDir = resolvePath(targetDir, 'dist');
  const entryPoints = readEntryPoints(packageJson);
  const scriptEntryPoints = entryPoints.filter(e =>
    SCRIPT_EXTS.includes(e.ext),
  );

  const external = (
    source: string,
    _importer?: string,
    isResolved?: boolean,
  ): boolean => {
    if (isResolved) return false;
    if (source.startsWith('.')) return false;
    if (source.startsWith('/')) return false;
    if (source.match(/^[a-z]:/i)) return false;
    return true;
  };

  if (outputs.cjs || outputs.esm) {
    const output: OutputOptions[] = [];
    const mainFields = ['module', 'main'];

    if (outputs.cjs) {
      output.push({
        dir: distDir,
        entryFileNames: '[name].cjs.js',
        chunkFileNames: 'cjs/[name]-[hash].cjs.js',
        format: 'cjs',
        sourcemap: true,
        preserveModules: true,
        preserveModulesRoot: `${targetDir}/src`,
        interop: 'compat',
        exports: 'named',
      });
    }

    if (outputs.esm) {
      output.push({
        dir: distDir,
        entryFileNames: '[name].esm.js',
        chunkFileNames: 'esm/[name]-[hash].esm.js',
        format: 'es',
        sourcemap: true,
        preserveModules: true,
        preserveModulesRoot: `${targetDir}/src`,
      });
      mainFields.unshift('browser');
    }

    configs.push({
      input: Object.fromEntries(
        scriptEntryPoints.map(e => [e.name, resolvePath(targetDir, e.path)]),
      ),
      output,
      onwarn,
      makeAbsoluteExternalsRelative: false,
      preserveEntrySignatures: 'strict',
      external,
      plugins: [
        resolve({
          mainFields,
          extensions: SCRIPT_EXTS,
        }),
        commonjs({
          include: /node_modules/,
          exclude: [/\/[^/]+\.(?:stories|test)\.[^/]+$/],
        }),
        postcss(),
        json(),
        yaml(),
        svgr({
          include: /\.icon\.svg$/,
        }),
        esbuild({
          target: 'ES2022',
          minify: minify ?? false,
        }),
      ],
    });
  }

  if (outputs.types) {
    const relativeDir = relative(paths.targetRoot, targetDir);
    const input = Object.fromEntries(
      scriptEntryPoints.map(e => [
        e.name,
        paths.resolveTargetRoot(
          'dist-types',
          relativeDir,
          e.path.replace(/\.(?:ts|tsx)$/, '.d.ts'),
        ),
      ]),
    );

    for (const typePath of Object.values(input)) {
      const declarationsExist = await fs.pathExists(typePath);
      if (!declarationsExist) {
        const declarationPath = relative(targetDir, typePath);
        throw new Error(
          `No declaration files found at ${declarationPath}, be sure to run ${chalk.bgRed.white('yarn tsc')} to generate .d.ts files before packaging`,
        );
      }
    }

    configs.push({
      input,
      output: {
        dir: distDir,
        entryFileNames: '[name].d.ts',
        chunkFileNames: 'types/[name]-[hash].d.ts',
        format: 'es',
      },
      external: source =>
        /\.css|scss|sass|svg|eot|woff|woff2|ttf$/.test(source) ||
        external(source),
      onwarn,
      plugins: [dts({ respectExternal: true })],
    });
  }

  return configs;
}

export async function buildPackage(options: BuildOptions): Promise<void> {
  const rollupConfigs = await makeRollupConfigs(options);
  await fs.remove(resolvePath(options.targetDir, 'dist'));

  for (const config of rollupConfigs) {
    await rollupBuild(config);
  }
}

export interface MultiBuildOptions {
  packages: PackageInfo[];
  minify?: boolean;
}

export interface BuildResult {
  package: string;
  success: boolean;
  error?: string;
}

export async function buildPackages(
  options: MultiBuildOptions,
): Promise<BuildResult[]> {
  const pLimit = (await import('p-limit')).default;
  const limit = pLimit(
    Math.max(1, Math.floor(require('os').cpus().length / 2)),
  );

  const results: BuildResult[] = [];

  const tasks = options.packages.map(pkg => {
    const role = detectRoleFromPackage(pkg.packageJson);
    if (!role) {
      console.warn(`Skipped ${pkg.name}: no role detected`);
      return null;
    }

    const outputs = getOutputsForRole(role);
    if (!outputs.cjs && !outputs.esm && !outputs.types) {
      return null;
    }

    return limit(async () => {
      const logPrefix = `${chalk.cyan(relative(paths.targetRoot, pkg.dir))}: `;
      console.log(`${logPrefix}Building...`);

      try {
        await buildPackage({
          targetDir: pkg.dir,
          packageJson: pkg.packageJson,
          outputs,
          minify: options.minify,
          logPrefix,
        });

        console.log(`${logPrefix}${chalk.green('Done')}`);
        results.push({ package: pkg.name, success: true });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`${logPrefix}${chalk.red('Failed')}`);
        results.push({ package: pkg.name, success: false, error: errorMsg });
      }
    });
  });

  await Promise.all(tasks.filter(Boolean));
  return results;
}
