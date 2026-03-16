import path from 'node:path';
import { buildLogFilePath, ensureDirectory, fileExists, writeTextFileAtomic } from './filesystem.js';
import {
  checkpointFromLog,
  checkpointFromTimestamp,
  readState,
  resolveStateFilePath,
  writeState
} from './state.js';
import type {
  ApexLogSummary,
  StoredCheckpoint,
  SyncDependencies,
  SyncLogItem,
  SyncMode,
  SyncQueryInput,
  SyncRequest,
  SyncResult
} from './types.js';

export const INITIAL_SYNC_LIMIT = 100;
export const DEFAULT_DOWNLOAD_CONCURRENCY = 4;

export class SyncExecutionError extends Error {
  public readonly result: SyncResult;

  public constructor(result: SyncResult) {
    super(`Failed to sync ${result.failed} Apex log(s).`);
    this.name = 'SyncExecutionError';
    this.result = result;
  }
}

export async function syncLogs(request: SyncRequest, dependencies: SyncDependencies): Promise<SyncResult> {
  const outputDir = await ensureDirectory(path.resolve(dependencies.outputDir));
  const stateFilePath = resolveStateFilePath(outputDir, dependencies.stateFilePath);
  const state = await readState(stateFilePath);
  const checkpointBefore = state.orgs[dependencies.org.key] ?? null;
  const mode = resolveMode(request, checkpointBefore);
  const queryInput: SyncQueryInput = {
    mode,
    checkpoint: checkpointBefore ?? undefined,
    since: request.since,
    limit: resolveLimit(mode, request.limit)
  };
  const defaultNow = (): Date => new Date();
  const now: () => Date = dependencies.now ?? defaultNow;

  const logs = await dependencies.listLogs(queryInput);
  const processedLogs = await mapLimit(
    logs,
    Math.max(1, Math.floor(dependencies.downloadConcurrency ?? DEFAULT_DOWNLOAD_CONCURRENCY)),
    async log => processLog(outputDir, dependencies.org.username, log, async logId => dependencies.fetchLogBody(logId))
  );

  const completedAt = now();
  const checkpointAfter = determineCheckpointAfter({
    mode,
    request,
    checkpointBefore,
    processedLogs,
    completedAt
  });

  if (checkpointAfter) {
    state.orgs[dependencies.org.key] = checkpointAfter;
  } else {
    delete state.orgs[dependencies.org.key];
  }

  await writeState(stateFilePath, state);

  const result: SyncResult = {
    org: dependencies.org,
    outputDir,
    checkpointBefore,
    checkpointAfter,
    mode,
    scanned: logs.length,
    downloaded: processedLogs.filter(log => log.action === 'downloaded').length,
    existing: processedLogs.filter(log => log.action === 'existing').length,
    failed: processedLogs.filter(log => log.action === 'failed').length,
    logs: processedLogs
  };

  if (result.failed > 0) {
    throw new SyncExecutionError(result);
  }

  return result;
}

function resolveMode(request: SyncRequest, checkpoint: StoredCheckpoint | null): SyncMode {
  if (request.full) {
    return 'full';
  }

  if (request.since) {
    return 'since';
  }

  if (checkpoint) {
    return 'incremental';
  }

  return 'initial';
}

function resolveLimit(mode: SyncMode, limit: number | undefined): number | undefined {
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    return Math.floor(limit);
  }

  if (mode === 'initial') {
    return INITIAL_SYNC_LIMIT;
  }

  return undefined;
}

function determineCheckpointAfter(args: {
  mode: SyncMode;
  request: SyncRequest;
  checkpointBefore: StoredCheckpoint | null;
  processedLogs: SyncLogItem[];
  completedAt: Date;
}): StoredCheckpoint | null {
  const { mode, request, checkpointBefore, processedLogs, completedAt } = args;

  if (processedLogs.length === 0) {
    if (mode === 'since' && request.since) {
      return checkpointFromTimestamp(request.since, completedAt);
    }

    return checkpointBefore;
  }

  const firstFailureIndex = processedLogs.findIndex(log => log.action === 'failed');
  const lastSuccessfulIndex = firstFailureIndex === -1 ? processedLogs.length - 1 : firstFailureIndex - 1;

  if (lastSuccessfulIndex >= 0) {
    const lastSuccessfulLog = processedLogs[lastSuccessfulIndex];
    if (lastSuccessfulLog) {
      return checkpointFromLog(lastSuccessfulLog, completedAt);
    }
  }

  if (mode === 'since' && request.since) {
    return checkpointFromTimestamp(request.since, completedAt);
  }

  return checkpointBefore;
}

async function processLog(
  outputDir: string,
  username: string,
  log: ApexLogSummary,
  fetchLogBody: SyncDependencies['fetchLogBody']
): Promise<SyncLogItem> {
  const filePath = buildLogFilePath(outputDir, username, log.id);

  try {
    if (await fileExists(filePath)) {
      return {
        ...log,
        filePath,
        action: 'existing'
      };
    }

    const body = await fetchLogBody(log.id);
    await writeTextFileAtomic(filePath, body);

    return {
      ...log,
      filePath,
      action: 'downloaded'
    };
  } catch {
    return {
      ...log,
      filePath,
      action: 'failed'
    };
  }
}

async function mapLimit<TInput, TResult>(
  items: TInput[],
  limit: number,
  mapper: (item: TInput, index: number) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) {
        return;
      }

      const currentItem = items[currentIndex];
      if (currentItem === undefined) {
        return;
      }

      // Each worker intentionally awaits its current item before advancing.
      // eslint-disable-next-line no-await-in-loop
      results[currentIndex] = await mapper(currentItem, currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}
