import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { ApexLogSummary, StateFile, StoredCheckpoint } from './types.js';

export const STATE_VERSION = 1 as const;
export const DEFAULT_STATE_FILE_NAME = '.sf-apex-log-viewer-state.json';

export function sanitizeFileNameSegment(value: string | undefined): string {
  return String(value ?? 'default').replace(/[^a-zA-Z0-9_.@-]+/g, '_');
}

export function buildOrgKey(instanceUrl: string | null, username: string): string {
  const normalizedInstance = String(instanceUrl ?? '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase();
  return `${normalizedInstance}|${String(username || '').trim().toLowerCase()}`;
}

export function normalizeTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return date.toISOString();
}

export function formatSoqlDateTimeLiteral(value: string): string {
  return normalizeTimestamp(value);
}

export function compareWatermarks(
  left: Pick<StoredCheckpoint, 'lastStartTime' | 'lastId'>,
  right: Pick<StoredCheckpoint, 'lastStartTime' | 'lastId'>
): number {
  const leftTime = Date.parse(normalizeTimestamp(left.lastStartTime));
  const rightTime = Date.parse(normalizeTimestamp(right.lastStartTime));

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.lastId.localeCompare(right.lastId);
}

export function checkpointFromLog(log: Pick<ApexLogSummary, 'id' | 'startTime'>, updatedAt: Date): StoredCheckpoint {
  return {
    lastStartTime: normalizeTimestamp(log.startTime),
    lastId: log.id,
    updatedAt: updatedAt.toISOString()
  };
}

export function checkpointFromTimestamp(timestamp: string, updatedAt: Date): StoredCheckpoint {
  return {
    lastStartTime: normalizeTimestamp(timestamp),
    lastId: '',
    updatedAt: updatedAt.toISOString()
  };
}

export function resolveStateFilePath(outputDir: string, explicitPath?: string): string {
  return path.resolve(explicitPath ?? path.join(outputDir, DEFAULT_STATE_FILE_NAME));
}

export async function readState(filePath: string): Promise<StateFile> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StateFile>;
    return normalizeState(parsed);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      return emptyState();
    }
    throw error;
  }
}

export async function writeState(filePath: string, state: StateFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

function emptyState(): StateFile {
  return {
    version: STATE_VERSION,
    orgs: {}
  };
}

function normalizeState(input: Partial<StateFile> | undefined): StateFile {
  const state = emptyState();
  const orgs = input?.orgs;

  if (!orgs || typeof orgs !== 'object') {
    return state;
  }

  for (const [key, value] of Object.entries(orgs)) {
    if (!value || typeof value !== 'object') {
      continue;
    }

    const lastStartTime = typeof value.lastStartTime === 'string' ? value.lastStartTime : '';
    const lastId = typeof value.lastId === 'string' ? value.lastId : '';
    const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : '';

    if (!lastStartTime) {
      continue;
    }

    try {
      state.orgs[key] = {
        lastStartTime: normalizeTimestamp(lastStartTime),
        lastId,
        updatedAt: updatedAt ? normalizeTimestamp(updatedAt) : new Date(0).toISOString()
      };
    } catch {
      // Ignore malformed checkpoints instead of failing the whole command.
    }
  }

  return state;
}
