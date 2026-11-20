# User Data for Velvet

Maintained by [ATTMonk](https://github.com/attmonk).

Optional server-backed user data for Velvet.

The package is `@attmonk/velvet-user-data`. The catalog plugin ID is `attmonk-user-data`.

This plugin adds encrypted account storage, cross-device playback progress, playlists, favorites,
and preferences. Velvet remains browser-storage-first when the plugin is not enabled.

## Enable It

Add the public ATTMonk catalog and select the plugin in your Velvet environment:

```env
VELVET_ENABLE_PLUGINS=true
VELVET_PLUGIN_CATALOGS_JSON=["https://raw.githubusercontent.com/attmonk/velvet-plugins/main/manifest.json"]
VELVET_PLUGIN_IDS=<plugin-id>
```

Replace the placeholder with the user-data entry’s `id` from the catalog manifest.
Then start Velvet normally:

```bash
docker compose up -d
```

Velvet downloads and verifies the plugin before starting its server. No package registry, token,
secret, or separate preparation command is required.

## Confirm It Is Active

Open **Settings → Modules**, or request:

```text
GET /api/plugins
```

The user-data module should report `provider: "plugin"` and `status: "active"`.

## Package Export

The package exposes both halves of the Velvet plugin contract:

```text
@attmonk/velvet-user-data/server
@attmonk/velvet-user-data/server/personalization-data
@attmonk/velvet-user-data/client
```

The server entry registers encrypted persistence routes and declares the bundled browser entry.
Velvet serves that browser bundle from the same origin; the bundle registers the optional
user-data provider through host API version 1. Without the plugin, Velvet keeps browser-local data
and does not provide server persistence.

## Development

```bash
npm install
npm test
npm run type-check
npm run build
```

## Releases

The **Release Package** GitHub workflow creates the version commit and tag under the `attmonk-ci`
identity, then publishes a packed archive and SHA-256 checksum as release assets.

Production deployments must use normal Velvet authentication and a base64
`USER_DATA_ENCRYPTION_KEY` of at least 32 bytes. Plugin data lives under
`VELVET_PLUGIN_DATA_DIR` and should use persistent storage.

## Upgrading an existing encrypted store

Keep the existing master key. Before updating an existing installation, set
`USER_DATA_DB_PATH` to its current database file and preserve the original HKDF
context in `USER_DATA_ENCRYPTION_INFO_PREFIX` and `USER_DATA_ENCRYPTION_SALT`.
Those values are deployment configuration; do not replace them while retaining
the encrypted database. New installations use ATTMonk defaults when unset.
Development installations can preserve their existing seed with
`USER_DATA_DEV_ENCRYPTION_SEED`. Update the host's selected plugin ID to
`attmonk-user-data` when installing the new catalog entry.
