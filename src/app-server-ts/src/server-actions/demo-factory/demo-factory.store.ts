import { ClobService } from '@buildone/app-server-tslib/modules';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Reading and writing the Demo Factory's temporary data sources from the server.
 *
 * The Studio's data sources are clob-backed (`b1_data_source_temporary`), which
 * the browser reaches over `/data/clob/<DsoName>`. The server has no reason to
 * go out over HTTP to talk to itself: `ClobService` is the same code that route
 * runs, so everything here is an in-process call — which is also what makes it
 * usable from `onModuleInit` and from the fire-and-forget child-process runner,
 * neither of which has a request to borrow credentials from.
 *
 * One wrapper rather than three copies of parse-and-commit: the materializer,
 * the run ingest and the seed service all move whole row sets around, and all
 * three want the same "replace what is there with this" semantics.
 */
@Injectable()
export class DemoFactoryStore {
  private readonly logger = new Logger(DemoFactoryStore.name);

  constructor(private readonly clob: ClobService) {}

  /**
   * Every row of a data source.
   *
   * No query is passed, so `ClobService` returns the payload whole rather than
   * a filtered page — these row sets are small (demos, scenes, the runs of one
   * workspace) and every caller here reconciles against the complete set.
   */
  async read<T>(dataSourceName: string): Promise<T[]> {
    const { content } = await this.clob.getClobData(dataSourceName);
    const parsed: unknown = JSON.parse(content || '[]');
    if (!Array.isArray(parsed)) {
      throw new TypeError(`${dataSourceName} is not backed by a JSON array — it cannot hold records`);
    }
    return parsed as T[];
  }

  /**
   * Apply a batch of changes, keyed by the data source's own `keyFields`.
   *
   * The key is resolved server-side from the data source, so nothing here has
   * to know which field it is — the same contract the browser writes under.
   */
  async commit<T extends object>(
    dataSourceName: string,
    changes: { createdRecords?: T[]; updatedRecords?: T[]; deletedRecords?: T[] }
  ): Promise<void> {
    const counts = {
      created: changes.createdRecords?.length ?? 0,
      updated: changes.updatedRecords?.length ?? 0,
      deleted: changes.deletedRecords?.length ?? 0
    };
    if (counts.created + counts.updated + counts.deleted === 0) return;

    await this.clob.commit(dataSourceName, changes as never);
    this.logger.log(`${dataSourceName}: +${counts.created} ~${counts.updated} -${counts.deleted}`);
  }

  /**
   * Make a data source hold exactly `rows`, matched by `key`.
   *
   * Expressed as one commit rather than a delete-all followed by a create-all:
   * a clob commit rewrites the whole array anyway, and doing it in two passes
   * leaves the data source empty in between — which a screen polling during a
   * reconcile would render as "no runs".
   */
  async replaceAll<T extends object>(dataSourceName: string, rows: T[], key: (row: T) => string): Promise<void> {
    const existing = await this.read<T>(dataSourceName);
    await this.commit(dataSourceName, diffRows(existing, rows, key));
  }
}

/**
 * The commit that turns `existing` into `wanted`, matched by `key`.
 *
 * A row already present with identical content is left out of the update set.
 * The reconcile runs on every server start and `nest --watch` restarts often;
 * without this every restart would rewrite four payloads that had not changed,
 * each a new version in the blueprint's history.
 */
export const diffRows = <T extends object>(
  existing: T[],
  wanted: T[],
  key: (row: T) => string
): { createdRecords: T[]; updatedRecords: T[]; deletedRecords: T[] } => {
  const wantedByKey = new Map(wanted.map((row) => [key(row), row]));
  const existingByKey = new Map(existing.map((row) => [key(row), row]));

  return {
    createdRecords: wanted.filter((row) => !existingByKey.has(key(row))),
    updatedRecords: wanted.filter((row) => {
      const current = existingByKey.get(key(row));
      return current !== undefined && !sameRow(current, row);
    }),
    deletedRecords: existing.filter((row) => !wantedByKey.has(key(row)))
  };
};

/** Structural equality with key order ignored — rows come back from JSON, where order is incidental. */
const sameRow = (left: unknown, right: unknown): boolean =>
  JSON.stringify(sortKeys(left)) === JSON.stringify(sortKeys(right));

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entryKey, entry]) => [entryKey, sortKeys(entry)])
    );
  }
  return value;
};
