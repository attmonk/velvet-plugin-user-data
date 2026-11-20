// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

describe('package boundary', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build:client'], { cwd: repoRoot, stdio: 'pipe' });
  });

  it('publishes server and browser entries expected by the Velvet runtime', () => {
    const manifest = readJson('package.json');

    expect(manifest.exports?.['./server']?.import).toBe('./src/server/index.js');
    expect(manifest.files).toContain('src/server');
    expect(manifest.files).toContain('README.md');
    expect(manifest.files).not.toContain('CONSUMING_APP_SETUP.md');
    expect(manifest.exports?.['./client']?.import).toBe('./dist/client/index.js');
    expect(manifest.files).toContain('dist/client');
    expect(manifest.peerDependencies || {}).toEqual({});
  });

  it('owns the SQLite dependency for server-backed user data', () => {
    const manifest = readJson('package.json');
    const lockfile = readJson('package-lock.json');

    expect(manifest.dependencies).toHaveProperty('better-sqlite3');
    expect(manifest.optionalDependencies || {}).not.toHaveProperty('better-sqlite3');
    expect(lockfile.packages['']).toHaveProperty('dependencies.better-sqlite3');
    expect(lockfile.packages[''].optionalDependencies || {}).not.toHaveProperty('better-sqlite3');
    expect(lockfile.packages['node_modules/better-sqlite3']).toBeTruthy();
  });

  it('packs only files required by the server and browser runtimes', () => {
    const packed = JSON.parse(
      execFileSync('npm', ['pack', '--json', '--dry-run'], {
        cwd: repoRoot,
        encoding: 'utf8',
      })
    );
    const files = packed[0].files.map((file) => file.path).sort();

    expect(files).toEqual(
      [
        'LICENSE',
        'README.md',
        'package.json',
        'dist/client/index.js',
        'src/server/index.js',
        'src/server/personalization-data.js',
        'src/server/routes.js',
        'src/server/sqlite-store.js',
        'src/server/user-data-crypto.js',
        'src/server/user-data-persistence.js',
      ].sort()
    );
  });
});
