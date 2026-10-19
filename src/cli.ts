#!/usr/bin/env node
import { runCli } from './cli/index.js';

runCli().catch((err) => {
  console.error('Error executing crew:', err);
  process.exit(1);
});
