import type { Connection, Org } from '@salesforce/core';
import type { ApexLogSummary, OrgDescriptor, StoredCheckpoint, SyncMode } from './types.js';
import { buildOrgKey, formatSoqlDateTimeLiteral } from './state.js';

type QueryResponse<TRecord> = {
  records?: TRecord[];
  done?: boolean;
  nextRecordsUrl?: string;
};

type ApexLogRecord = {
  Id?: string;
  StartTime?: string;
  Status?: string;
  Operation?: string;
  Application?: string;
  LogLength?: number | string | null;
  LogUser?: {
    Name?: string;
  } | null;
};

export type ListApexLogsRequest = {
  mode: SyncMode;
  checkpoint?: StoredCheckpoint;
  since?: string;
  limit?: number;
  apiVersion?: string;
};

export function buildOrgDescriptor(org: Org, apiVersion?: string): OrgDescriptor {
  const connection = org.getConnection(apiVersion);
  const username = org.getUsername() ?? connection.getUsername() ?? 'default';
  const authFields = connection.getConnectionOptions();
  const instanceUrl = typeof authFields.instanceUrl === 'string' ? authFields.instanceUrl : null;

  return {
    key: buildOrgKey(instanceUrl, username),
    username,
    instanceUrl,
    apiVersion: connection.getApiVersion()
  };
}

export function buildListApexLogsSoql(request: ListApexLogsRequest): string {
  const baseSelect =
    'SELECT Id, StartTime, Status, Operation, Application, LogLength, LogUser.Name FROM ApexLog';
  const safeLimit =
    typeof request.limit === 'number' && Number.isFinite(request.limit) && request.limit > 0
      ? Math.floor(request.limit)
      : undefined;

  if (request.mode === 'initial') {
    const limit = safeLimit ?? 100;
    return `${baseSelect} ORDER BY StartTime DESC, Id DESC LIMIT ${limit}`;
  }

  const clauses: string[] = [];

  if (request.mode === 'since') {
    if (!request.since) {
      throw new Error('Missing --since value for since mode.');
    }

    clauses.push(`StartTime >= ${formatSoqlDateTimeLiteral(request.since)}`);
  }

  if (request.mode === 'incremental') {
    if (!request.checkpoint) {
      throw new Error('Missing checkpoint for incremental mode.');
    }

    const checkpointTime = formatSoqlDateTimeLiteral(request.checkpoint.lastStartTime);
    const escapedId = escapeSoqlString(request.checkpoint.lastId);
    clauses.push(`(StartTime > ${checkpointTime} OR (StartTime = ${checkpointTime} AND Id > '${escapedId}'))`);
  }

  const whereClause = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limitClause = safeLimit ? ` LIMIT ${safeLimit}` : '';
  return `${baseSelect}${whereClause} ORDER BY StartTime ASC, Id ASC${limitClause}`;
}

export async function listApexLogs(org: Org, request: ListApexLogsRequest): Promise<ApexLogSummary[]> {
  const connection = org.getConnection(request.apiVersion);
  const soql = buildListApexLogsSoql(request);

  const records: ApexLogSummary[] = [];
  let response = await queryTooling<ApexLogRecord>(connection, soql);

  for (;;) {
    for (const rawRecord of response.records ?? []) {
      const normalized = normalizeApexLogRecord(rawRecord);
      if (normalized) {
        records.push(normalized);
      }
    }

    if (response.done === true || !response.nextRecordsUrl) {
      break;
    }

    // Pagination is sequential because each response yields the next cursor URL.
    // eslint-disable-next-line no-await-in-loop
    response = await queryToolingMore<ApexLogRecord>(connection, response.nextRecordsUrl);
  }

  if (request.mode === 'initial') {
    records.reverse();
  }

  return records;
}

export async function fetchApexLogBody(org: Org, logId: string, apiVersion?: string): Promise<string> {
  const connection = org.getConnection(apiVersion);
  const request = {
    method: 'GET' as const,
    url: `${connection.baseUrl()}/tooling/sobjects/ApexLog/${logId}/Body`,
    headers: {
      'content-type': 'text/plain'
    }
  };

  const response = await requestWithAuthRetry<unknown>(connection, request);
  return typeof response === 'string' ? response : String(response ?? '');
}

function normalizeApexLogRecord(record: ApexLogRecord): ApexLogSummary | undefined {
  const id = typeof record.Id === 'string' ? record.Id : '';
  const startTime = typeof record.StartTime === 'string' ? record.StartTime : '';

  if (!id || !startTime) {
    return undefined;
  }

  const logLength =
    typeof record.LogLength === 'number'
      ? record.LogLength
      : typeof record.LogLength === 'string' && record.LogLength.trim()
        ? Number(record.LogLength)
        : null;

  return {
    id,
    startTime,
    status: typeof record.Status === 'string' ? record.Status : '',
    operation: typeof record.Operation === 'string' ? record.Operation : '',
    application: typeof record.Application === 'string' ? record.Application : '',
    userName: typeof record.LogUser?.Name === 'string' ? record.LogUser.Name : null,
    logLength: typeof logLength === 'number' && Number.isFinite(logLength) ? logLength : null
  };
}

async function queryTooling<TRecord>(connection: Connection, soql: string): Promise<QueryResponse<TRecord>> {
  const url = `${connection.baseUrl()}/tooling/query?q=${encodeURIComponent(soql)}`;
  return requestWithAuthRetry<QueryResponse<TRecord>>(connection, url);
}

async function queryToolingMore<TRecord>(
  connection: Connection,
  nextRecordsUrl: string
): Promise<QueryResponse<TRecord>> {
  const normalizedUrl = /^https?:\/\//i.test(nextRecordsUrl) ? nextRecordsUrl : connection.normalizeUrl(nextRecordsUrl);
  return requestWithAuthRetry<QueryResponse<TRecord>>(connection, normalizedUrl);
}

async function requestWithAuthRetry<TResult>(
  connection: Connection,
  request:
    | string
    | {
        method: 'GET';
        url: string;
        headers?: Record<string, string>;
      }
): Promise<TResult> {
  try {
    return await connection.request<TResult>(request);
  } catch (error) {
    if (!isAuthRefreshableError(error)) {
      throw error;
    }

    await connection.refreshAuth();
    return connection.request<TResult>(request);
  }
}

function isAuthRefreshableError(error: unknown): boolean {
  const statusCode =
    (error as { statusCode?: number } | undefined)?.statusCode ??
    (error as { response?: { statusCode?: number } } | undefined)?.response?.statusCode;

  if (statusCode === 401) {
    return true;
  }

  const code = String((error as { errorCode?: string } | undefined)?.errorCode ?? '').toUpperCase();
  if (code === 'INVALID_SESSION_ID') {
    return true;
  }

  const message = String((error as { message?: string } | undefined)?.message ?? error ?? '').toUpperCase();
  return message.includes('INVALID_SESSION_ID');
}

function escapeSoqlString(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}
