import { Command } from 'commander';
import { spawn } from 'node:child_process';
import fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import type { ESLint as ESLintType } from 'eslint';
import { paths } from '../lib/paths.js';
import { buildPackage, type BuildOptions } from '../lib/builder.js';
import {
  detectRoleFromPackage,
  getOutputsForRole,
  type PackageInfo,
} from '../lib/packages.js';

async function loadPackageJson(): Promise<PackageInfo['packageJson']> {
  return fs.readJson(paths.resolveTarget('package.json'));
}

export function registerPackageCommands(program: Command): void {
  const pkg = program
    .command('package')
    .description('Commands for working with a single package');

  pkg
    .command('build')
    .description('Build the current package')
    .option('--minify', 'Minify the output')
    .action(async opts => {
      const spinner = ora('Building package...').start();

      try {
        const packageJson = await loadPackageJson();
        const role = detectRoleFromPackage(packageJson);

        if (!role) {
          spinner.fail('No package role detected');
          process.exit(1);
        }

        const outputs = getOutputsForRole(role);
        if (!outputs.cjs && !outputs.esm && !outputs.types) {
          spinner.info('Package has no build outputs for this role');
          return;
        }

        const buildOptions: BuildOptions = {
          targetDir: paths.targetDir,
          packageJson,
          outputs,
          minify: opts.minify,
        };

        await buildPackage(buildOptions);
        spinner.succeed('Package built successfully');
      } catch (error) {
        spinner.fail('Build failed');
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  pkg
    .command('clean')
    .description('Clean build output directories')
    .action(async () => {
      const spinner = ora('Cleaning...').start();

      try {
        await Promise.all([
          fs.remove(paths.resolveTarget('dist')),
          fs.remove(paths.resolveTarget('dist-types')),
          fs.remove(paths.resolveTarget('coverage')),
        ]);
        spinner.succeed('Cleaned');
      } catch (error) {
        spinner.fail('Clean failed');
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  pkg
    .command('lint')
    .description('Lint the current package')
    .argument('[directories...]', 'Directories to lint')
    .option('--fix', 'Fix lint errors')
    .option('--format <format>', 'Output format', 'stylish')
    .option('--max-warnings <number>', 'Max warnings before failing', '-1')
    .action(async (directories: string[], opts) => {
      const { ESLint } = await import('eslint');

      // ESLint 9 (flat config) determines which files to lint from the
      // resolved config's `files`, not a constructor `extensions` option.
      const eslint = new ESLint({
        cwd: paths.targetDir,
        fix: opts.fix,
      });

      const results = await eslint.lintFiles(
        directories.length ? directories : ['.'],
      );

      const maxWarnings = parseInt(opts.maxWarnings, 10);
      const ignoreWarnings = maxWarnings === -1;
      const totalWarnings = results.reduce(
        (acc: number, r: ESLintType.LintResult) => acc + r.warningCount,
        0,
      );
      const totalErrors = results.reduce(
        (acc: number, r: ESLintType.LintResult) => acc + r.errorCount,
        0,
      );
      const failed =
        totalErrors > 0 || (!ignoreWarnings && totalWarnings > maxWarnings);

      if (opts.fix) {
        await ESLint.outputFixes(results);
      }

      const formatter = await eslint.loadFormatter(opts.format);
      const output = await formatter.format(results);

      if (output) {
        console.log(output);
      }

      if (failed) {
        process.exit(1);
      }
    });

  pkg
    .command('test')
    .description('Test the current package')
    .allowUnknownOption()
    .action(async (_opts, command) => {
      const args = command.args.slice(0);

      if (
        !process.env.CI &&
        !args.includes('--coverage') &&
        !args.some((a: string) => a.includes('--watch'))
      ) {
        args.push('--watch');
      }

      if (!args.some((a: string) => a.includes('passWithNoTests'))) {
        args.push('--passWithNoTests');
      }

      if (!process.env.NODE_ENV) {
        process.env.NODE_ENV = 'test';
      }

      if (!process.env.TZ) {
        process.env.TZ = 'UTC';
      }

      const child = spawn('npx', ['vitest', ...args], {
        cwd: paths.targetDir,
        stdio: 'inherit',
        env: process.env,
      });

      child.on('exit', code => {
        process.exit(code ?? 0);
      });
    });

  pkg
    .command('start')
    .description('Start the package in development mode')
    .action(async () => {
      const packageJson = await loadPackageJson();
      const role = detectRoleFromPackage(packageJson);

      if (role === 'backend' || role === 'backend-plugin') {
        const child = spawn('npx', ['tsx', 'watch', 'src/index.ts'], {
          cwd: paths.targetDir,
          stdio: 'inherit',
          env: process.env,
        });
        child.on('exit', code => process.exit(code ?? 0));
      } else {
        console.log(
          chalk.yellow('No start command defined for this package role'),
        );
      }
    });

  pkg
    .command('prepack')
    .description('Prepare package for publishing')
    .action(async () => {
      const spinner = ora('Preparing for publish...').start();

      try {
        const packageJsonPath = paths.resolveTarget('package.json');
        const packageJson = await fs.readJson(packageJsonPath);

        const backup = { ...packageJson };
        await fs.writeJson(
          paths.resolveTarget('package.json.prepack'),
          backup,
          { spaces: 2 },
        );

        if (packageJson.main?.startsWith('src/')) {
          packageJson.main = packageJson.main
            .replace('src/', 'dist/')
            .replace('.ts', '.cjs.js');
        }

        if (packageJson.types?.startsWith('src/')) {
          packageJson.types = packageJson.types
            .replace('src/', 'dist/')
            .replace('.ts', '.d.ts');
        }

        await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
        spinner.succeed('Package prepared for publishing');
      } catch (error) {
        spinner.fail('Prepack failed');
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  pkg
    .command('postpack')
    .description('Restore package after publishing')
    .action(async () => {
      const spinner = ora('Restoring package...').start();

      try {
        const backupPath = paths.resolveTarget('package.json.prepack');
        const packageJsonPath = paths.resolveTarget('package.json');

        if (await fs.pathExists(backupPath)) {
          const backup = await fs.readJson(backupPath);
          await fs.writeJson(packageJsonPath, backup, { spaces: 2 });
          await fs.remove(backupPath);
        }

        spinner.succeed('Package restored');
      } catch (error) {
        spinner.fail('Postpack failed');
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
