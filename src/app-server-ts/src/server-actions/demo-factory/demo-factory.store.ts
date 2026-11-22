import { ClobService, DataService } from '@buildone/app-server-tslib/modules';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Reading and writing the Demo Factory's data sources from the server.
 *
 * Two kinds sit behind the same names. The Studio's records — demos, scenes,
 * demo users, jobs, runs — are embedded data sources over app tables (see
 * `drizzle/schema/demoFactory.table.ts`); the settings, stage and host rows are
 * clob-backed shape rows whose values the handlers in `demo-factory.events.ts`
 * fill from this process. `DataService` is the code `/data/<DsoName>` runs and
 * dispatches to either backing by the data source's type, so nothing here has
 * to know which a name is — and the server never goes out over HTTP to talk to
 * itself, which is what makes this usable from `onModuleInit` and from the
 * fire-and-forget job runner, neither of which has a request to borrow
 * credentials from.
 *
 * Writes go through `commitData` rather than straight to Drizzle on purpose:
 * that is what runs the data source's `serverEventsHandler` (the materializer
 * validates and writes `demo.yaml` from its hooks) and publishes the entity
 * change every open Studio screen refreshes on.
 */
@Injectable()
export class DemoFactoryStore {
  private readonly logger = new Logger(DemoFactoryStore.name);

  constructor(
    private readonly data: DataService,
    private readonly clob: ClobService
  ) {}

  /**
   * Every row of a data source.
   *
   * Unpaged: `top: -1` lifts the data service's default limit of 100. These
   * row sets are small (the demos and scenes of one Studio, the runs on one
   * volume) and every caller here reconciles against the complete set. A clob
   * payload is read whole, without a query, as before.
   */
  async read<T>(dataSourceName: string): Promise<T[]> {
    const { backing } = await this.data.getDataProperties({ entity: dataSourceName });
    if (backing === 'clob') {
      const { content } = await this.clob.getClobData(dataSourceName);
      const parsed: unknown = JSON.parse(content || '[]');
      if (!Array.isArray(parsed)) {
        throw new TypeError(`${dataSourceName} is not backed by a JSON array — it cannot hold records`);
      }
      return parsed as T[];
    }
    const rows: unknown = await this.data.getData({
      entity: dataSourceName,
      queryParams: { queryInformation: JSON.stringify({ filters: [] }), filter: JSON.stringify({ top: -1 }) }
    } as Parameters<DataService['getData']>[0]);
    return (Array.isArray(rows) ? rows : []) as T[];
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

    await this.data.commitData({
      entity: dataSourceName,
      createdRecords: (changes.createdRecords ?? []) as Record<string, unknown>[],
      updatedRecords: (changes.updatedRecords ?? []) as Record<string, unknown>[],
      deletedRecords: (changes.deletedRecords ?? []) as Record<string, unknown>[]
    });
    this.logger.log(`${dataSourceName}: +${counts.created} ~${counts.updated} -${counts.deleted}`);
  }

  /**
   * Make a data source hold exactly `rows`, matched by `key`.
   *
   * Only the difference is written — rows to create, rows whose content
   * changed, rows to delete — so the rows another writer added meanwhile under
   * a different key are the only thing at stake, and only for a caller that
   * means "exactly these" (the run reconcile, which owns its row set).
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
 * without this every restart would rewrite every row that had not changed.
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
