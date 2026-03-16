# summary

Sync Apex logs into a local apexlogs directory.

# description

Download new Apex logs for a target org into a predictable local directory so agents and local tools can inspect them without re-fetching the same logs over and over.

# flags.output-dir.summary

Directory where the downloaded Apex log files should be stored.

# flags.target-org.summary

Username or alias of the target org.

# flags.api-version.summary

API version to use for org requests.

# flags.since.summary

Ignore the saved checkpoint for this run and only consider logs at or after the provided ISO timestamp.

# flags.full.summary

Ignore the saved checkpoint and rescan all available logs, while still skipping files that already exist on disk.

# flags.limit.summary

Maximum number of log headers to process in this run.

# errors.fullAndSince

Use either --full or --since, not both.

# errors.syncFailed

Failed to sync %s Apex log(s).

# errors.limit

The --limit flag must be a positive integer.

# output.header

Apex Log Sync

# output.org

Org: %s

# output.instanceUrl

Instance URL: %s

# output.outputDir

Output dir: %s

# output.mode

Mode: %s

# output.summary

Scanned: %s | Downloaded: %s | Existing: %s | Failed: %s

# examples

- Sync new logs into ./apexlogs:

  <%= config.bin %> <%= command.id %> --target-org my-org@example.com

- Sync new logs and return JSON:

  <%= config.bin %> <%= command.id %> --target-org my-org@example.com --json

- Start the checkpoint from a specific time:

  <%= config.bin %> <%= command.id %> --target-org my-org@example.com --since 2026-03-15T19:00:00Z

- Rescan all available logs without re-downloading files already on disk:

  <%= config.bin %> <%= command.id %> --target-org my-org@example.com --full
