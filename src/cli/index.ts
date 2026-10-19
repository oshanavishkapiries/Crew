import { Command } from 'commander';
import { COMMANDS } from './declarations.js';
import type { CommandDefinition } from './types.js';

export function createCli(commands: CommandDefinition[] = COMMANDS): Command {
  const program = new Command();

  program
    .name('crew')
    .description('Turn AI coding agents into a dev team with its own memory')
    .version('0.1.0');

  for (const def of commands) {
    const cmd = program.command(def.name);
    cmd.description(def.summary);

    if (def.args) {
      for (const arg of def.args) {
        const argStr = arg.variadic
          ? arg.required ? `<${arg.name}...>` : `[${arg.name}...]`
          : arg.required ? `<${arg.name}>` : `[${arg.name}]`;
        cmd.argument(argStr, arg.description);
      }
    }

    if (def.options) {
      for (const opt of def.options) {
        if (opt.defaultValue !== undefined) {
          cmd.option(opt.flags, opt.description, opt.defaultValue as any);
        } else {
          cmd.option(opt.flags, opt.description);
        }
      }
    }

    cmd.action(async (...args: any[]) => {
      if (def.action) {
        await def.action(...args);
      } else {
        console.log(`crew ${def.name}: command not implemented in this build.`);
      }
    });
  }

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = createCli();
  await program.parseAsync(argv);
}
