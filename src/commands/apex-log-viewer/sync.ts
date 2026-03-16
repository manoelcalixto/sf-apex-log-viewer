import path from 'node:path';
import { Messages, Org, SfError } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { buildOrgDescriptor, fetchApexLogBody, listApexLogs } from '../../salesforce.js';
import { SyncExecutionError, syncLogs } from '../../sync.js';
import type { SyncResult } from '../../types.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@electivus/sf-apex-log-viewer', 'apex-log-viewer.sync');

export default class Sync extends SfCommand<SyncResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly enableJsonFlag = true;

  public static readonly flags = {
    'target-org': Flags.string({
      required: true,
      summary: messages.getMessage('flags.target-org.summary')
    }),
    'api-version': Flags.string({
      summary: messages.getMessage('flags.api-version.summary')
    }),
    'output-dir': Flags.directory({
      summary: messages.getMessage('flags.output-dir.summary'),
      default: 'apexlogs'
    }),
    since: Flags.string({
      summary: messages.getMessage('flags.since.summary')
    }),
    full: Flags.boolean({
      summary: messages.getMessage('flags.full.summary'),
      default: false
    }),
    limit: Flags.string({
      summary: messages.getMessage('flags.limit.summary')
    })
  };

  public async run(): Promise<SyncResult> {
    const { flags } = await this.parse(Sync);

    if (flags.full && flags.since) {
      throw new SfError(messages.getMessage('errors.fullAndSince'));
    }

    const outputDir = path.resolve(flags['output-dir']);
    const targetOrg = await Org.create({ aliasOrUsername: flags['target-org'] });
    const apiVersion = flags['api-version'];
    const limit = parseLimit(flags.limit);
    const org = buildOrgDescriptor(targetOrg, apiVersion);

    try {
      const result = await syncLogs(
        {
          full: flags.full,
          since: flags.since,
          limit
        },
        {
          org,
          outputDir,
          listLogs: async input => listApexLogs(targetOrg, {
              ...input,
              apiVersion
            }),
          fetchLogBody: async logId => fetchApexLogBody(targetOrg, logId, apiVersion)
        }
      );

      this.renderHumanResult(result);
      return result;
    } catch (error) {
      if (error instanceof SyncExecutionError) {
        this.renderHumanResult(error.result);
        throw new SfError(messages.getMessage('errors.syncFailed', [String(error.result.failed)]));
      }

      throw error;
    }
  }

  private renderHumanResult(result: SyncResult): void {
    if (this.jsonEnabled()) {
      return;
    }

    this.styledHeader(messages.getMessage('output.header'));
    this.log(messages.getMessage('output.org', [result.org.username]));
    if (result.org.instanceUrl) {
      this.log(messages.getMessage('output.instanceUrl', [result.org.instanceUrl]));
    }
    this.log(messages.getMessage('output.outputDir', [result.outputDir]));
    this.log(messages.getMessage('output.mode', [result.mode]));
    this.log(
      messages.getMessage('output.summary', [
        String(result.scanned),
        String(result.downloaded),
        String(result.existing),
        String(result.failed)
      ])
    );
  }
}

function parseLimit(input: string | undefined): number | undefined {
  if (!input) {
    return undefined;
  }

  const parsed = Number(input);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new SfError(messages.getMessage('errors.limit'));
  }

  return parsed;
}
