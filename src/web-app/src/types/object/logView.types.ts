import type { ObjectAttributes, ObjectBlueprint, ObjectInstance } from '@buildone/web-core';

/**
 * Blueprint attributes of a `b1_log_view` — the project-owned object type
 * that follows a running server-side process (issue #17). It carries no DATA
 * link: the log tail comes from the server action named in `logSource`, which
 * the view polls itself while the process runs.
 */
export interface LogViewAttributes extends ObjectAttributes {
  headerLabel: string;
  /** service/class/method of the action to poll — see the type's howToUse. */
  logSource: string;
  pollIntervalMs: number;
  maxLines: number;
  autoScroll: boolean;
  htmlClass: string;
}

export type LogViewBlueprint = ObjectBlueprint<LogViewAttributes>;
export type LogView = ObjectInstance<LogViewBlueprint>;

/** What the polled action answers — the shape of the demo factory's job-status. */
export interface LogSnapshot {
  status: string;
  step: string | null;
  exitCode: number | null;
  demoId?: string | null;
  logs: { stream: 'stdout' | 'stderr' | string; text: string }[];
}
