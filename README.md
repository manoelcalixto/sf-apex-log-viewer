# sf-apex-log-viewer

`sf-apex-log-viewer` is a Salesforce CLI plugin focused on one job: keeping a local `apexlogs` directory in sync with new Apex logs so AI agents and local tools can inspect them quickly.

The first version is intentionally sync-first. It does not try to replace `rg`, your editor, or downstream analysis tools. It downloads raw logs to disk, keeps a per-org checkpoint, and returns structured JSON for automation.

## Why this exists

When an agent is helping inside a Salesforce project, the hard part is often not analyzing a log, but getting the new logs onto disk in a predictable place without repeating work.

This plugin gives us:

- Incremental sync by org using a persisted checkpoint.
- Stable local files under `./apexlogs`.
- JSON output that is easy to call from agents or scripts.
- Fast sync behavior without extra parsing work during download.

## Install

```bash
sf plugins link .
```

For a packaged install later:

```bash
sf plugins install sf-apex-log-viewer@x.y.z
```

## Usage

Sync new logs into the default `./apexlogs` directory:

```bash
sf apex-log-viewer sync --target-org my-org@example.com
```

Sync and emit machine-readable output:

```bash
sf apex-log-viewer sync --target-org my-org@example.com --json
```

Start a fresh checkpoint from a specific moment:

```bash
sf apex-log-viewer sync --target-org my-org@example.com --since 2026-03-15T19:00:00Z
```

Rescan all available logs without re-downloading files that already exist:

```bash
sf apex-log-viewer sync --target-org my-org@example.com --full
```

Choose a custom directory:

```bash
sf apex-log-viewer sync --target-org my-org@example.com --output-dir .agent/apexlogs
```

## Sync behavior

- Default output directory: `./apexlogs`
- Default state file: `<output-dir>/.sf-apex-log-viewer-state.json`
- First sync without a checkpoint: downloads the latest 100 logs
- Later syncs: download only logs newer than the saved `(StartTime, Id)` watermark
- `--full`: ignores the checkpoint for discovery, but still skips files that already exist on disk
- `--since`: uses the provided timestamp as the cutoff for that execution

Downloaded logs are saved as:

```text
<username>_<logId>.log
```

## Development

Install dependencies and build:

```bash
npm install --ignore-scripts
npm run build
```

Run the command locally:

```bash
node ./bin/dev.js apex-log-viewer sync --help
```

Run tests:

```bash
npm test
```

## Secure publishing

This repository is configured for npm Trusted Publishing through GitHub Actions instead of a long-lived write token.

Before publishing from GitHub Actions, configure npm Trusted Publishing with:

- Repository owner: `Electivus`
- Repository name: `sf-apex-log-viewer`
- Workflow filename: `onRelease.yml`

After Trusted Publishing is working, prefer this npm package setting:

- `Require two-factor authentication and disallow tokens`

That setup keeps interactive 2FA for humans while letting GitHub Actions publish through short-lived OIDC credentials.
