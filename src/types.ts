export type SyncMode = 'initial' | 'incremental' | 'since' | 'full';

export type Watermark = {
  lastStartTime: string;
  lastId: string;
};

export type StoredCheckpoint = Watermark & {
  updatedAt: string;
};

export type StateFile = {
  version: 1;
  orgs: Record<string, StoredCheckpoint>;
};

export type OrgDescriptor = {
  key: string;
  username: string;
  instanceUrl: string | null;
  apiVersion: string;
};

export type ApexLogSummary = {
  id: string;
  startTime: string;
  status: string;
  operation: string;
  application: string;
  userName: string | null;
  logLength: number | null;
};

export type SyncAction = 'downloaded' | 'existing' | 'failed';

export type SyncLogItem = ApexLogSummary & {
  filePath: string;
  action: SyncAction;
};

export type SyncResult = {
  org: OrgDescriptor;
  outputDir: string;
  checkpointBefore: StoredCheckpoint | null;
  checkpointAfter: StoredCheckpoint | null;
  mode: SyncMode;
  scanned: number;
  downloaded: number;
  existing: number;
  failed: number;
  logs: SyncLogItem[];
};

export type SyncRequest = {
  full?: boolean;
  since?: string;
  limit?: number;
};

export type SyncQueryInput = {
  mode: SyncMode;
  checkpoint?: StoredCheckpoint;
  since?: string;
  limit?: number;
};

export type SyncDependencies = {
  org: OrgDescriptor;
  outputDir: string;
  stateFilePath?: string;
  downloadConcurrency?: number;
  now?: () => Date;
  listLogs(input: SyncQueryInput): Promise<ApexLogSummary[]>;
  fetchLogBody(logId: string): Promise<string>;
};
