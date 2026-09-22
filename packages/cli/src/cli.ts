import { program } from 'commander';
import { registerPackageCommands } from './commands/package.js';
import { registerRepoCommands } from './commands/repo.js';

program
  .name('roadie-cli')
  .description('CLI for building Roadie packages')
  .version('0.1.0');

registerPackageCommands(program);
registerRepoCommands(program);

program.parse();
