// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { registerUserDataRoutes, userDataClientEntry } from '../src/server/index.js';

describe('User Data route registration', () => {
  it('exposes the plugin-owned route registrar', () => {
    expect(registerUserDataRoutes).toBeTypeOf('function');
  });

  it('declares the bundled browser entry for the Velvet host', () => {
    expect(userDataClientEntry).toBeInstanceOf(URL);
    expect(userDataClientEntry.pathname).toMatch(/\/dist\/client\/index\.js$/);
  });
});
