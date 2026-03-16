import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { buildListApexLogsSoql } from '../src/salesforce.js';
import { compareWatermarks } from '../src/state.js';

describe('buildListApexLogsSoql', () => {
  it('builds the initial query with the default descending order', () => {
    const soql = buildListApexLogsSoql({ mode: 'initial', limit: 100 });
    assert.match(soql, /ORDER BY StartTime DESC, Id DESC LIMIT 100$/);
  });

  it('builds an incremental query with StartTime and Id tie-breaks', () => {
    const soql = buildListApexLogsSoql({
      mode: 'incremental',
      checkpoint: {
        lastStartTime: '2026-03-15T20:00:00.000Z',
        lastId: '07L000000000001AAA',
        updatedAt: '2026-03-15T20:00:30.000Z'
      }
    });

    assert.match(
      soql,
      /WHERE \(StartTime > 2026-03-15T20:00:00\.000Z OR \(StartTime = 2026-03-15T20:00:00\.000Z AND Id > '07L000000000001AAA'\)\) ORDER BY StartTime ASC, Id ASC$/
    );
  });

  it('builds a full query with ascending order and an optional limit', () => {
    const soql = buildListApexLogsSoql({ mode: 'full', limit: 50 });
    assert.match(soql, /ORDER BY StartTime ASC, Id ASC LIMIT 50$/);
  });
});

describe('compareWatermarks', () => {
  it('uses the log id as a tie-breaker when StartTime is identical', () => {
    const older = {
      lastStartTime: '2026-03-15T20:00:00.000Z',
      lastId: '07L000000000001AAA'
    };
    const newer = {
      lastStartTime: '2026-03-15T20:00:00.000Z',
      lastId: '07L000000000002AAA'
    };

    assert(compareWatermarks(older, newer) < 0);
  });
});
