// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflows = [
  '.github/workflows/publish-package.yml',
  '.github/workflows/release-package.yml',
];

describe('release asset workflows', () => {
  for (const workflow of workflows) {
    it(`${workflow} publishes a packed archive and checksum without an npm registry`, () => {
      const source = readFileSync(workflow, 'utf8');

      expect(source).toContain('npm pack --json');
      expect(source).toContain('sha256sum');
      expect(source).toContain('gh release create');
      expect(source).not.toContain('npm publish');
      expect(source).not.toContain('npm.pkg.');
    });
  }
});
