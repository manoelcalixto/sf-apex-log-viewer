import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { expect } from 'chai';

let testSession: TestSession;

describe('apex-log-viewer sync NUTs', () => {
  before('prepare session', async () => {
    testSession = await TestSession.create();
  });

  after(async () => {
    await testSession?.clean();
  });

  it('shows command help', () => {
    const result = execCmd('apex-log-viewer sync --help', { ensureExitCode: 0 });
    expect(result.shellOutput.stdout).to.include('Sync Apex logs into a local apexlogs directory.');
  });
});
