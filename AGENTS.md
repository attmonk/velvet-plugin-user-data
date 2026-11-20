# Repository Guidelines

## Project Structure & Module Organization

This package is the extracted user data plugin for Velvet media apps. Client/browser code lives in `src/client/`, including the manager, storage adapters, crypto helpers, TanStack React DB local collections, and client tests under `src/client/__tests__/`. Server-side Node modules live in `src/server/`, including persistence, envelope crypto, and personalization helpers. Additional Node-focused tests live in `tests/`. Keep public API changes aligned with the exports in `package.json`.

## Build, Test, and Development Commands

- `npm install` installs development dependencies.
- `npm run type-check` runs strict TypeScript checks.
- `npm run build` attempts declaration-only output for consumers.
- `npm test` runs the full Vitest suite once.
- `npm run test:watch` starts Vitest in watch mode.
- `npm run lint` is a placeholder until ESLint is adopted.

## Coding Style & Naming Conventions

Use ES modules throughout. Client modules are TypeScript; server modules are JavaScript unless a test requires TypeScript. Keep TypeScript strict-compatible and prefer explicit exported types for public client APIs. Use descriptive camelCase for functions and variables, PascalCase for classes such as `UserDataManager`, and UPPER_SNAKE_CASE for constants. Preserve the existing compact style: two-space indentation, single quotes, and small focused modules.

## Testing Guidelines

Vitest is the test runner with `node` as the default environment. Name tests `*.test.ts`, `*.spec.ts`, `*.test.js`, or `*.spec.js`. Put client unit tests beside client code in `src/client/__tests__/`; keep server and persistence tests in `tests/`. For browser-specific behavior, use per-file Vitest environment comments when needed. Run `npm test` and `npm run type-check` before opening a pull request.

## Commit & Pull Request Guidelines

The repository currently has only an initial commit, so no detailed commit convention is established. Use short, imperative commit subjects such as `Add local collection tests` or `Fix account storage fallback`. Pull requests should include a brief summary, affected client/server areas, linked issues when applicable, and test results. Include screenshots only for consuming-app UI changes.

## Security & Configuration Tips

Do not commit credentials, encryption keys, or app-specific secrets. Server crypto expects `USER_DATA_ENCRYPTION_KEY` to be a base64 key of at least 32 bytes unless auth is disabled for development. Treat `VITE_DISABLE_AUTH=true` and weak dev keys as local-only settings. Keep `protectUserDataEndpoints` in place when adapting server routes.

## ATTMonk bot attribution and clean history

Use `attmonk-ci <342793482+attmonk-ci[bot]@users.noreply.github.com>` for both
author and committer. Set `attmonk.requireBotAttribution=true` in this checkout
and keep the commit guard enabled. Use Conventional Commits and no co-author
trailers. Pushes, tags, workflow runs and releases use the existing ATTMonk
GitHub App; CI credentials accept `ATTMONK_CI_APPKEY` or `ATTMONK_CI_APP_KEY`.

Keep history limited to clean ATTMonk snapshots and subsequent reviewed work.
Do not merge or push retired histories, branches or tags. Import upstream work
through reviewed patches or source snapshots so retired ancestry is not restored.
Legacy deployment compatibility values belong in local/server environment
configuration, never tracked source. Preserve runtime identities and storage
together when migrating existing installations.
