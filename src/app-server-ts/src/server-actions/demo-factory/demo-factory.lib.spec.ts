import { buildJobCommand } from './demo-factory.lib';

describe('render job selection', () => {
  const runId = '2026-10-01T10-50-19-979Z--b9f42092';

  it('passes the selected run as a CLI argument', () => {
    expect(buildJobCommand({ action: 'render', demoId: 'demo', runId }).args).toEqual([
      'render',
      'demo',
      `--run=${runId}`
    ]);
  });

  it('keeps latest-run rendering for existing callers', () => {
    expect(buildJobCommand({ action: 'render', demoId: 'demo' }).args).toEqual(['render', 'demo']);
  });

  it.each(['../escape', '/absolute', 'run;echo', 'run/other'])('rejects unsafe run id %s', (unsafe) => {
    expect(() => buildJobCommand({ action: 'render', demoId: 'demo', runId: unsafe })).toThrow('Invalid render run id');
  });

  it('rejects run selection for stages other than render', () => {
    expect(() => buildJobCommand({ action: 'all', demoId: 'demo', runId })).toThrow('Invalid render run id');
  });
});
