import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { relative } from 'node:path';
import fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import { paths } from '../lib/paths.js';
import { buildPackages } from '../lib/builder.js';
import {
  PackageGraph,
  detectRoleFromPackage,
  getOutputsForRole,
} from '../lib/packages.js';

export function registerRepoCommands(program: Command): void {
  const repo = program
    .command('repo')
    .description('Commands for working with the entire repository');

  repo
    .command('build')
    .description('Build all packages in the repository')
    .option('--all', 'Build all packages including apps and backends')
    .option('--minify', 'Minify the output')
    .option('--since <ref>', 'Only build packages changed since ref')
    .action(async opts => {
      console.log(chalk.blue('Building packages...'));

      try {
        let packages = await PackageGraph.listTargetPackages();

        const buildablePackages = packages.filter(pkg => {
          const buildScript = pkg.packageJson.scripts?.build ?? '';

          const usesCli =
            buildScript.includes('roadie-cli package build') ||
            buildScript.includes('roadie-cli package build');

          if (!usesCli) {
            return false;
          }

          const role = detectRoleFromPackage(pkg.packageJson);

          if (!role) {
            return false;
          }

          if (!opts.all && (role === 'frontend' || role === 'backend')) {
            return false;
          }

          const outputs = getOutputsForRole(role);
          return outputs.cjs || outputs.esm || outputs.types;
        });

        if (buildablePackages.length === 0) {
          console.log(chalk.yellow('No packages to build'));
          return;
        }

        console.log(
          chalk.dim(`Found ${buildablePackages.length} packages to build`),
        );

        const results = await buildPackages({
          packages: buildablePackages,
          minify: opts.minify,
        });

        const failures = results.filter(r => !r.success);
        const successes = results.filter(r => r.success);

        console.log('');
        if (successes.length > 0) {
          console.log(
            chalk.green(`Built ${successes.length} packages successfully`),
          );
        }

        if (failures.length > 0) {
          console.log(
            chalk.red(`\nFailed to build ${failures.length} packages:`),
          );
          for (const failure of failures) {
            console.log(chalk.red(`  - ${failure.package}`));
            if (failure.error) {
              console.log(chalk.dim(`    ${failure.error.split('\n')[0]}`));
            }
          }
          process.exit(1);
        }
      } catch (error) {
        console.error(chalk.red('Build failed'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  repo
    .command('clean')
    .description('Clean all packages in the repository')
    .action(async () => {
      const spinner = ora('Cleaning all packages...').start();

      try {
        const packages = await PackageGraph.listTargetPackages();

        await Promise.all(
          packages.map(async pkg => {
            await Promise.all([
              fs.remove(`${pkg.dir}/dist`),
              fs.remove(`${pkg.dir}/dist-types`),
              fs.remove(`${pkg.dir}/coverage`),
            ]);
          }),
        );

        await fs.remove(paths.resolveTargetRoot('dist-types'));

        spinner.succeed(`Cleaned ${packages.length} packages`);
      } catch (error) {
        spinner.fail('Clean failed');
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  repo
    .command('lint')
    .description('Lint all packages in the repository')
    .option('--fix', 'Fix lint errors')
    .action(async opts => {
      console.log(chalk.blue('Linting all packages...'));

      const packages = await PackageGraph.listTargetPackages();
      const packagesToLint = packages.filter(pkg => {
        const hasLintScript = pkg.packageJson.scripts?.lint;
        return hasLintScript;
      });

      let failed = false;
      const pLimit = (await import('p-limit')).default;
      const limit = pLimit(4);

      const tasks = packagesToLint.map(pkg =>
        limit(async () => {
          const prefix = `${chalk.cyan(relative(paths.targetRoot, pkg.dir))}: `;

          try {
            const args = opts.fix ? ['run', 'lint', '--fix'] : ['run', 'lint'];

            await new Promise<void>((resolve, reject) => {
              const child = spawn('yarn', args, {
                cwd: pkg.dir,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: process.env,
              });

              let output = '';
              child.stdout?.on('data', data => {
                output += data.toString();
              });
              child.stderr?.on('data', data => {
                output += data.toString();
              });

              child.on('exit', code => {
                if (code !== 0) {
                  console.log(prefix + chalk.red('Failed'));
                  console.log(output);
                  reject(new Error(`Lint failed for ${pkg.name}`));
                } else {
                  console.log(prefix + chalk.green('OK'));
                  resolve();
                }
              });
            });
          } catch {
            failed = true;
          }
        }),
      );

      await Promise.all(tasks);

      if (failed) {
        process.exit(1);
      }

      console.log(chalk.green('Lint complete'));
    });

  repo
    .command('test')
    .description('Test all packages in the repository')
    .allowUnknownOption()
    .action(async (_opts, command) => {
      console.log(chalk.blue('Testing all packages...'));

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
        cwd: paths.targetRoot,
        stdio: 'inherit',
        env: process.env,
      });

      child.on('exit', code => {
        process.exit(code ?? 0);
      });
    });
}
