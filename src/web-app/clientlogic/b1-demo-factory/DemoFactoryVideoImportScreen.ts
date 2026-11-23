/**
 * Client logic of the "Import screen recording" dialog.
 *
 * Two steps, one per fieldset of DemoFactoryVideoImportForm:
 *
 * 1. The b1_file_upload only picks the file (no auto upload): this logic
 *    sends it to `demo-factory/upload/*` in chunks, showing the progress in
 *    the read-only `uploadStatus` field; the upload id lands in `uploadId`
 *    (and an id and title for the demo are suggested from the file name, if
 *    none were typed yet).
 * 2. "Analyze & create demo" starts `import-video`. The dialog closes at once;
 *    the analysis runs as an ordinary pipeline job, and when it has saved the
 *    demo the search list repositions to it.
 *
 * Like every dialog of the search screen, these handlers are resolved against
 * the screen that launched the dialog — hence the re-exports in
 * DemoFactoryDemoSearch.ts — and find the dialog's form from the event.
 */
import {
  closeScreen,
  displayError,
  displayInfo,
  displaySuccess,
  displayWarning,
  translate,
  type ObjectInstance
} from '@buildone/web-core';

import {
  DEMO_ID_PATTERN,
  DSO,
  SEARCH_SCREEN,
  callStudio,
  dsoOf,
  errorMessage,
  formOf,
  openScreen,
  refreshDemos,
  screenOfObject,
  type DemoRow,
  type Job
} from '../shared/demoFactoryStudio';

const FORM = 'DemoFactoryVideoImportForm';
const JOB_POLL_MS = 2500;

/** Where the recording goes, slice by slice — see demo-factory.upload.controller.ts. */
const UPLOAD_URL = '/service/app/demo-factory/upload';
/** Attempts per chunk before the upload gives up (a dropped connection, a proxy hiccup). */
const CHUNK_ATTEMPTS = 4;

interface UploadMeta {
  uploadId: string;
  originalName: string;
  sizeBytes: number;
}

/** The payload of eventUploadFileAdd: PrimeVue's select event. */
interface SelectEvent {
  files?: File[] | FileList;
}

/** `Meine CRM-Tour (final).mp4` → `meine-crm-tour-final`. */
const slugOf = (fileName: string): string =>
  fileName
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\da-z]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function post<T>(url: string, body: BodyInit, contentType: string): Promise<T> {
  const response = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': contentType } });
  const text = await response.text();
  let answer: Record<string, unknown> = {};
  try {
    answer = JSON.parse(text || '{}') as Record<string, unknown>;
  } catch {
    // A proxy's HTML error page: only the status says anything.
  }
  if (!response.ok) {
    const message = Array.isArray(answer.message) ? answer.message.join(', ') : answer.message;
    throw new UploadError(
      String(message || `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`),
      response.status
    );
  }
  return answer as T;
}

/**
 * Upload the recording in slices: one request for the whole file does not get
 * past every proxy (Codespaces' port forwarding refuses bodies over ~15 MB).
 * After a chunk failed — a dropped connection, a proxy hiccup, a chunk the
 * server holds only part of (409) — the upload resumes from the byte the
 * server says it holds.
 */
async function uploadInChunks(file: File, onProgress: (fraction: number) => void): Promise<UploadMeta> {
  const { uploadId, chunkBytes } = await post<{ uploadId: string; chunkBytes: number }>(
    `${UPLOAD_URL}/start`,
    JSON.stringify({ fileName: file.name, sizeBytes: file.size, mimeType: file.type }),
    'application/json'
  );
  let offset = 0;
  let failures = 0;
  while (offset < file.size) {
    const slice = file.slice(offset, Math.min(offset + chunkBytes, file.size));
    try {
      ({ receivedBytes: offset } = await post<{ receivedBytes: number }>(
        `${UPLOAD_URL}/${uploadId}/chunk?offset=${offset}`,
        slice,
        'application/octet-stream'
      ));
      failures = 0;
    } catch (error) {
      const status = error instanceof UploadError ? error.status : 0;
      const retriable = status === 0 || status === 408 || status === 409 || status === 429 || status >= 500;
      if (!retriable || ++failures >= CHUNK_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * failures));
      ({ receivedBytes: offset } = await post<{ receivedBytes: number }>(
        `${UPLOAD_URL}/${uploadId}/status`,
        '',
        'application/json'
      ));
    }
    onProgress(offset / file.size);
  }
  return post<UploadMeta>(`${UPLOAD_URL}/${uploadId}/finish`, '', 'application/json');
}

let uploading = false;

/** A recording was chosen in the upload field: send it, then fill the form from the answer. */
export async function onVideoSelected(eventSource: ObjectInstance, eventPayload: SelectEvent): Promise<void> {
  const form = formOf(eventSource, FORM);
  const file = Array.from(eventPayload?.files ?? []).at(-1);
  if (!form || !file) return;
  if (uploading) {
    displayWarning(
      translate(
        'b1App.messages.DemoFactoryVideoImportScreen.stillUploading',
        'A recording is still uploading — wait until it is done.'
      )
    );
    return;
  }
  uploading = true;
  form.setValue('uploadId', '');
  let shown = -1;
  try {
    const answer = await uploadInChunks(file, (fraction) => {
      const percent = Math.floor(fraction * 100);
      if (percent === shown) return;
      shown = percent;
      form.setValue(
        'uploadStatus',
        translate('b1App.messages.DemoFactoryVideoImportScreen.uploadProgress', 'Uploading {fileName} … {percent} %', {
          fileName: file.name,
          percent
        })
      );
    });
    form.setValue('uploadId', answer.uploadId);
    const megabytes = (answer.sizeBytes / 1024 / 1024).toLocaleString(document.documentElement.lang || undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
    form.setValue(
      'uploadStatus',
      translate('b1App.messages.DemoFactoryVideoImportScreen.uploaded', '{fileName} — {size} MB uploaded', {
        fileName: answer.originalName,
        size: megabytes
      })
    );
    const name = answer.originalName || file.name;
    if (!String(form.getValue('demoId') ?? '').trim()) form.setValue('demoId', slugOf(name));
    if (!String(form.getValue('title') ?? '').trim()) form.setValue('title', name.replace(/\.[^.]+$/, ''));
    displaySuccess(
      translate('b1App.messages.DemoFactoryVideoImportScreen.uploadDone', '{fileName} uploaded.', { fileName: name })
    );
  } catch (error) {
    form.setValue('uploadStatus', '');
    displayError(
      translate('b1App.messages.DemoFactoryVideoImportScreen.uploadFailed', 'Upload failed — {reason}', {
        reason: errorMessage(error)
      }),
      {
        life: 10_000
      }
    );
  } finally {
    uploading = false;
  }
}

export async function importVideo(eventSource: ObjectInstance): Promise<void> {
  const form = formOf(eventSource, FORM);
  const screen = screenOfObject(form);
  if (!screen || !form) {
    displayError(
      translate('b1App.messages.DemoFactoryVideoImportScreen.formNotFound', 'The import form was not found.')
    );
    return;
  }
  const uploadId = String(form.getValue('uploadId') ?? '').trim();
  const demoId = String(form.getValue('demoId') ?? '').trim();
  const title = String(form.getValue('title') ?? '').trim();
  const language = String(form.getValue('language') ?? '').trim();
  if (uploading) {
    displayWarning(
      translate('b1App.messages.DemoFactoryVideoImportScreen.waitForUpload', 'Wait until the recording is uploaded.')
    );
    return;
  }
  if (!uploadId) {
    displayWarning(
      translate('b1App.messages.DemoFactoryVideoImportScreen.uploadMissing', 'Upload the screen recording first.')
    );
    return;
  }
  if (!DEMO_ID_PATTERN.test(demoId)) {
    displayWarning(
      translate(
        'b1App.messages.DemoFactoryVideoImportScreen.invalidId',
        'A demo id is lowercase letters, digits and hyphens.'
      )
    );
    return;
  }
  const search = openScreen(SEARCH_SCREEN);
  if ((dsoOf<DemoRow>(search, DSO.demo)?.records.value ?? []).some((row) => row.id === demoId)) {
    displayWarning(
      translate('b1App.messages.DemoFactoryVideoImportScreen.demoExists', 'A demo with this id already exists.')
    );
    return;
  }

  try {
    await callStudio('import-video', {
      uploadId,
      demoId,
      title: title || demoId,
      ...(language && language !== 'auto' ? { language } : {})
    });
  } catch (error) {
    displayError(errorMessage(error));
    return;
  }
  closeScreen(screen);
  displayInfo(
    translate(
      'b1App.messages.DemoFactoryVideoImportScreen.analyzing',
      'Analyzing the recording — cutting scenes and transcribing your voice…'
    ),
    {
      life: 6000
    }
  );
  await watchAnalysis(demoId);
}

/** Follow the analyze job; when the demo exists, put the search list on it. */
async function watchAnalysis(demoId: string): Promise<void> {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
    let job: Job;
    try {
      job = await callStudio<Job>('job-status');
    } catch {
      return;
    }
    if (job.status === 'running') continue;
    if (job.status === 'complete') {
      await refreshDemos(openScreen(SEARCH_SCREEN), demoId);
      const created = [...job.logs].reverse().find((line) => line.text.startsWith(`Demo ${demoId} created`))?.text;
      displaySuccess(
        created
          ? translate(
              'b1App.messages.DemoFactoryVideoImportScreen.analysisDoneWithLog',
              '{created} Open it to review the scenes and narration.',
              { created }
            )
          : translate(
              'b1App.messages.DemoFactoryVideoImportScreen.analysisDone',
              'Demo {demoId} created. Open it to review the scenes and narration.',
              { demoId }
            ),
        { life: 8000 }
      );
    } else {
      const last = [...job.logs].reverse().find((line) => line.stream === 'stderr')?.text;
      displayError(
        last
          ? translate(
              'b1App.messages.DemoFactoryVideoImportScreen.analysisFailedWithReason',
              'The analysis failed — {reason}',
              { reason: last }
            )
          : translate(
              'b1App.messages.DemoFactoryVideoImportScreen.analysisFailed',
              'The analysis failed — see the pipeline log.'
            ),
        { life: 10_000 }
      );
    }
    return;
  }
}
