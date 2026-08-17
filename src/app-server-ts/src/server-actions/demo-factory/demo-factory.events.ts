import { IServerEventsHandler } from '@buildone/app-server-tslib/utils';
import { Injectable } from '@nestjs/common';

import { DemoFactoryHost } from './demo-factory.host';
import { HostRow, SettingRow, StageRow } from './demo-factory.rows';

/**
 * Server event handlers for the data sources whose truth is *this process*,
 * not their payload.
 *
 * Settings, the stage verdicts and the host's capabilities all describe the
 * server the Studio is talking to right now. Their clob payloads hold only the
 * row *shape* — a row per key, per stage, one host row — and every read is
 * overwritten from the live state in `onAfterFetch`. That keeps a settings
 * screen honest across a `nest --watch` restart or a provisioner that wrote a
 * new key file a minute ago, and it is what stops a secret from ever landing in
 * the payload: the stored row for a secret key has an empty value by
 * construction, and the read path fills in only `configured`.
 */

@Injectable()
export class DemoFactorySettingEvents implements IServerEventsHandler<SettingRow> {
  constructor(private readonly host: DemoFactoryHost) {}

  /** Replace every stored row's fields with the effective setting right now. */
  async onAfterFetch(records: SettingRow[]): Promise<void> {
    const live = new Map((await this.host.settingRows()).map((row) => [row.key, row]));
    for (const record of records) {
      const current = live.get(record.key);
      if (current) Object.assign(record, current);
    }
  }

  /**
   * A write from the Settings tab lands in the process, not the payload.
   *
   * What *is* persisted is the row's shape and nothing else: the payload is
   * exported to git and shared between workspaces, and a value in it — secret
   * or not — would be a workspace-local setting leaking into both. The next read
   * restores the truthful value and `configured` from `onAfterFetch`.
   */
  onBeforeUpdate(record: SettingRow): SettingRow {
    this.host.applySetting(record.key, record.value);
    return shapeOnly(record);
  }

  /** A created row is a shape row from the seed; there is nothing to apply. */
  onBeforeCreate(record: SettingRow): SettingRow {
    return shapeOnly(record);
  }
}

const shapeOnly = (record: SettingRow): SettingRow => ({
  ...record,
  value: '',
  configured: false,
  source: 'unset'
});

@Injectable()
export class DemoFactoryStageEvents implements IServerEventsHandler<StageRow> {
  constructor(private readonly host: DemoFactoryHost) {}

  async onAfterFetch(records: StageRow[]): Promise<void> {
    const live = new Map((await this.host.stageRows()).map((row) => [row.id, row]));
    for (const record of records) {
      const current = live.get(record.id);
      if (current) Object.assign(record, current);
    }
  }
}

@Injectable()
export class DemoFactoryHostEvents implements IServerEventsHandler<HostRow> {
  constructor(private readonly host: DemoFactoryHost) {}

  async onAfterFetch(records: HostRow[]): Promise<void> {
    const current = await this.host.hostRow();
    for (const record of records) Object.assign(record, current);
  }
}
