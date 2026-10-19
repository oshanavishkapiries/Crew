import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { ensureCrewHome, getCrewDbPath } from '../config.js';
import * as schema from './schema.js';

export * as schema from './schema.js';

export interface CrewDatabase {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
  close: () => void;
}

export interface DatabaseOptions {
  dbPath?: string;
  inMemory?: boolean;
  migrationsFolder?: string;
}

export function findPackageRoot(startDir: string = path.dirname(fileURLToPath(import.meta.url))): string {
  let current = startDir;
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error('Could not find package root containing package.json');
    }
    current = parent;
  }
}

export function getMigrationsFolder(): string {
  const root = findPackageRoot();
  return path.join(root, 'drizzle');
}

export function runMigrations(
  sqlite: Database.Database,
  options?: { migrationsFolder?: string }
): void {
  const migrationsFolder = options?.migrationsFolder || getMigrationsFolder();
  const migrations = readMigrationFiles({ migrationsFolder });

  // Baseline legacy databases created by inline scripts before migrations were tracked
  const hasWorkspaces = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'")
    .get();
  const hasMigrations = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();

  if (hasWorkspaces && !hasMigrations && migrations.length > 0) {
    sqlite.exec(
      'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (\n' +
      '  id SERIAL PRIMARY KEY,\n' +
      '  hash text NOT NULL,\n' +
      '  created_at numeric\n' +
      ');'
    );
    sqlite
      .prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)')
      .run(migrations[0].hash, migrations[0].folderMillis);
  }

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
}

export function createCrewDatabase(options: DatabaseOptions = {}): CrewDatabase {
  let sqlite: Database.Database;

  if (options.inMemory) {
    sqlite = new Database(':memory:');
  } else {
    ensureCrewHome();
    const dbPath = options.dbPath || getCrewDbPath();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    sqlite = new Database(dbPath);
  }

  // WAL mode for concurrency and performance
  sqlite.pragma('journal_mode = WAL');
  // Enforce foreign key constraints
  sqlite.pragma('foreign_keys = ON');

  // Run migrations
  runMigrations(sqlite, { migrationsFolder: options.migrationsFolder });

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}

let defaultInstance: CrewDatabase | null = null;

export function getDb(): CrewDatabase {
  if (!defaultInstance) {
    defaultInstance = createCrewDatabase();
  }
  return defaultInstance;
}

export function closeDefaultDb(): void {
  if (defaultInstance) {
    defaultInstance.close();
    defaultInstance = null;
  }
}
