import { strict as assert } from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, it } from 'mocha';
import { buildLogFilePath } from '../src/filesystem.js';
import { buildOrgKey, checkpointFromTimestamp, readState, writeState } from '../src/state.js';
import { SyncExecutionError, syncLogs } from '../src/sync.js';
import type { ApexLogSummary, OrgDescriptor, StoredCheckpoint, SyncQueryInput } from '../src/types.js';

const tempDirs = new Set<string>();

describe('syncLogs', () => {
  afterEach(async () => {
    for (const tempDir of tempDirs) {
      // Cleanup is intentionally sequential to avoid Windows file-lock races.
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    tempDirs.clear();
  });

  it('uses the initial default limit and saves downloaded logs', async () => {
    const tempDir = await createTempDir();
    let capturedInput: SyncQueryInput | undefined;

    const result = await syncLogs(
      {},
      {
        org: createOrgDescriptor(),
        outputDir: tempDir,
        listLogs: async input => {
          capturedInput = input;
          return [
            makeLog('07L000000000001AAA', '2026-03-15T20:00:00.000Z'),
            makeLog('07L000000000002AAA', '2026-03-15T20:01:00.000Z')
          ];
        },
        fetchLogBody: async logId => `body:${logId}`
      }
    );

    assert.equal(capturedInput?.mode, 'initial');
    assert.equal(capturedInput?.limit, 100);
    assert.equal(result.downloaded, 2);
    assert.equal(result.failed, 0);
    assert.equal(result.checkpointAfter?.lastId, '07L000000000002AAA');

    const firstFile = buildLogFilePath(tempDir, result.org.username, '07L000000000001AAA');
    assert.equal(await fs.readFile(firstFile, 'utf8'), 'body:07L000000000001AAA');

    const state = await readState(path.join(tempDir, '.sf-apex-log-viewer-state.json'));
    assert.equal(state.orgs[result.org.key]?.lastId, '07L000000000002AAA');
  });

  it('uses incremental mode when a checkpoint already exists', async () => {
    const tempDir = await createTempDir();
    const org = createOrgDescriptor();
    const checkpoint: StoredCheckpoint = {
      lastStartTime: '2026-03-15T20:01:00.000Z',
      lastId: '07L000000000002AAA',
      updatedAt: '2026-03-15T20:01:30.000Z'
    };

    await writeState(path.join(tempDir, '.sf-apex-log-viewer-state.json'), {
      version: 1,
      orgs: {
        [org.key]: checkpoint
      }
    });

    let capturedInput: SyncQueryInput | undefined;
    const result = await syncLogs(
      {},
      {
        org,
        outputDir: tempDir,
        listLogs: async input => {
          capturedInput = input;
          return [];
        },
        fetchLogBody: async logId => `body:${logId}`
      }
    );

    assert.equal(capturedInput?.mode, 'incremental');
    assert.equal(capturedInput?.checkpoint?.lastId, checkpoint.lastId);
    assert.equal(result.scanned, 0);
    assert.deepEqual(result.checkpointAfter, checkpoint);
  });

  it('creates a synthetic checkpoint for --since even when no logs are returned', async () => {
    const tempDir = await createTempDir();
    const since = '2026-03-15T12:34:56.000Z';

    const result = await syncLogs(
      { since },
      {
        org: createOrgDescriptor(),
        outputDir: tempDir,
        listLogs: async () => [],
        fetchLogBody: async logId => `body:${logId}`
      }
    );

    const expected = checkpointFromTimestamp(since, new Date(result.checkpointAfter!.updatedAt));
    assert.equal(result.mode, 'since');
    assert.deepEqual(result.checkpointAfter, expected);
  });

  it('keeps the checkpoint conservative when a later download fails', async () => {
    const tempDir = await createTempDir();
    const org = createOrgDescriptor();

    await assert.rejects(
      () =>
        syncLogs(
          {},
          {
            org,
            outputDir: tempDir,
            downloadConcurrency: 2,
            listLogs: async () => [
              makeLog('07L000000000001AAA', '2026-03-15T20:00:00.000Z'),
              makeLog('07L000000000002AAA', '2026-03-15T20:00:00.000Z'),
              makeLog('07L000000000003AAA', '2026-03-15T20:01:00.000Z')
            ],
            fetchLogBody: async logId => {
              if (logId === '07L000000000002AAA') {
                throw new Error('boom');
              }

              return `body:${logId}`;
            }
          }
        ),
      (error: unknown) => {
        assert(error instanceof SyncExecutionError);
        assert.equal(error.result.failed, 1);
        assert.equal(error.result.logs[1]?.action, 'failed');
        return true;
      }
    );

    const state = await readState(path.join(tempDir, '.sf-apex-log-viewer-state.json'));
    assert.equal(state.orgs[org.key]?.lastId, '07L000000000001AAA');
  });

  it('skips re-downloading files that already exist during a full sync', async () => {
    const tempDir = await createTempDir();
    const org = createOrgDescriptor();
    const existingPath = buildLogFilePath(tempDir, org.username, '07L000000000001AAA');
    await fs.mkdir(path.dirname(existingPath), { recursive: true });
    await fs.writeFile(existingPath, 'existing body', 'utf8');

    const fetchedLogIds: string[] = [];
    const result = await syncLogs(
      { full: true },
      {
        org,
        outputDir: tempDir,
        listLogs: async () => [
          makeLog('07L000000000001AAA', '2026-03-15T20:00:00.000Z'),
          makeLog('07L000000000002AAA', '2026-03-15T20:01:00.000Z')
        ],
        fetchLogBody: async logId => {
          fetchedLogIds.push(logId);
          return `body:${logId}`;
        }
      }
    );

    assert.equal(result.existing, 1);
    assert.equal(result.downloaded, 1);
    assert.deepEqual(fetchedLogIds, ['07L000000000002AAA']);
  });
});

function createOrgDescriptor(): OrgDescriptor {
  const username = 'agent@example.com';
  const instanceUrl = 'https://example.my.salesforce.com';

  return {
    key: buildOrgKey(instanceUrl, username),
    username,
    instanceUrl,
    apiVersion: '62.0'
  };
}

function makeLog(id: string, startTime: string): ApexLogSummary {
  return {
    id,
    startTime,
    status: 'Success',
    operation: 'Execute Anonymous',
    application: 'Developer Console',
    userName: 'Agent User',
    logLength: 128
  };
}

async function createTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-apex-log-viewer-'));
  tempDirs.add(tempDir);
  return tempDir;
}
