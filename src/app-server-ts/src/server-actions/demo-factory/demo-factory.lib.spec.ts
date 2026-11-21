import { assertSafeId, buildJobCommand, newUploadId, stageBlockedReason, UPLOAD_ID_PATTERN } from './demo-factory.lib';

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

describe('video import', () => {
  const host = {
    hasFactory: true,
    hasDependencies: true,
    canRecord: false,
    canRender: true,
    canAuthenticate: false
  };

  it('builds the analyze command with the upload, the title as one argument and the language', () => {
    expect(
      buildJobCommand({
        action: 'analyze',
        demoId: 'crm-tour',
        uploadId: '20261121101500-abc123',
        title: 'CRM Tour\nmit Zeilenumbruch',
        language: 'de'
      })
    ).toEqual({
      script: 'src/cli.mjs',
      args: [
        'analyze',
        'crm-tour',
        '--upload=20261121101500-abc123',
        '--title=CRM Tour mit Zeilenumbruch',
        '--language=de'
      ],
      step: 'analyze'
    });
  });

  it.each(['../x', 'UP', '', 'a/b'])('rejects unsafe upload id %p', (uploadId) => {
    expect(() => buildJobCommand({ action: 'analyze', demoId: 'demo', uploadId })).toThrow('Invalid upload id');
  });

  it('converts through run-demo, which signs in to every application first', () => {
    expect(buildJobCommand({ action: 'convert', demoId: 'crm-tour' })).toEqual({
      script: 'tools/run-demo.mjs',
      args: ['crm-tour', '--stages=convert'],
      step: 'convert'
    });
  });

  it('needs a browser, ffmpeg and a sign-in to convert', () => {
    const able = { ...host, canRecord: true, canAuthenticate: true };
    expect(stageBlockedReason('convert', able)).toBeNull();
    expect(stageBlockedReason('convert', { ...able, canRecord: false })).toMatch(/no browser/);
    expect(stageBlockedReason('convert', { ...able, canRender: false })).toMatch(/ffmpeg/);
    expect(stageBlockedReason('convert', { ...able, canAuthenticate: false })).toMatch(/API key/);
  });

  it('records and runs a demo cut from a video without browser or sign-in', () => {
    expect(stageBlockedReason('record', host, { filmsInBrowser: false })).toBeNull();
    expect(stageBlockedReason('all', host, { filmsInBrowser: false })).toBeNull();
    expect(stageBlockedReason('record', host)).toMatch(/no browser/);
    expect(stageBlockedReason('all', { ...host, canRecord: true })).toMatch(/API key/);
  });

  it('needs ffmpeg to analyze and to cut clips', () => {
    const noFfmpeg = { ...host, canRender: false };
    expect(stageBlockedReason('analyze', noFfmpeg)).toMatch(/ffmpeg/);
    expect(stageBlockedReason('record', noFfmpeg, { filmsInBrowser: false })).toMatch(/ffmpeg/);
  });

  it('mints upload ids the id pattern accepts', () => {
    const id = newUploadId(new Date('2026-11-21T10:15:00Z'));
    expect(id).toMatch(UPLOAD_ID_PATTERN);
    expect(id.startsWith('20261121101500-')).toBe(true);
  });
});

describe('reserved output directories', () => {
  it.each(['uploads', 'logs'])('%s is never a demo id, so no media route reaches it', (name) => {
    expect(() => assertSafeId(name, 'demo id')).toThrow('Invalid demo id');
  });

  it('accepts an ordinary demo id', () => {
    expect(assertSafeId('profile-menu-customize', 'demo id')).toBe('profile-menu-customize');
  });
});
