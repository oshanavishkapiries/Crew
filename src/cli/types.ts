export type CommandCategory = 'human' | 'agent' | 'orchestrator';

export interface CommandArg {
  name: string;
  description: string;
  required?: boolean;
  variadic?: boolean;
}

export interface CommandOption {
  flags: string;
  description: string;
  defaultValue?: string | boolean | number;
}

export interface CommandExample {
  description: string;
  command: string;
}

export interface CommandDefinition {
  name: string;
  category: CommandCategory;
  summary: string;
  description: string;
  args?: CommandArg[];
  options?: CommandOption[];
  examples?: CommandExample[];
  action?: (...args: any[]) => Promise<void> | void;
  hidden?: boolean;
}
