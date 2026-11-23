import { type IServerDataSourceReadable } from '@buildone/app-server-tslib/modules';
import {
  convertFilterToFilterList,
  evaluateFilterList,
  extractFilterFromQueryParameters,
  type RawDataFetchQueryParameters
} from '@buildone/app-server-tslib/utils';
import { Controller, Get, Query } from '@nestjs/common';

import { buildReel, ReelDemo } from './demo-factory.reel';
import { DemoRow, DSO, RunRow, RunSceneRow, SceneRow } from './demo-factory.rows';
import { DemoFactorySeedService } from './demo-factory.seed';
import { DemoFactoryStore } from './demo-factory.store';

/**
 * Backs `DemoFactoryReelDSO`, the `b1_data_source_server` of the Studio's
 * overview: one record per demo with its frames (see demo-factory.reel.ts),
 * rendered by the `b1_card_view` DemoFactoryReelCardView with the card
 * template DemoFactoryReelCard.vue.
 *
 * Read-only and unpaged: a Studio has a handful of demos, and the reel is
 * assembled from four data sources, so there is no table to page in. The
 * data source's filters (its globalSearchFilter, behind the card view's
 * search in cardViewPanelMenu, and saved filters) are applied to the
 * assembled records here.
 */
@Controller('demo-factory/reel')
export class DemoFactoryReel implements IServerDataSourceReadable<ReelDemo> {
  constructor(
    private readonly store: DemoFactoryStore,
    private readonly seed: DemoFactorySeedService
  ) {}

  @Get()
  async fetch(@Query() query: RawDataFetchQueryParameters): Promise<ReelDemo[]> {
    await this.seed.ensureReconciled();
    const [demos, scenes, runs, runScenes] = await Promise.all([
      this.store.read<DemoRow>(DSO.demo),
      this.store.read<SceneRow>(DSO.scene),
      this.store.read<RunRow>(DSO.run),
      this.store.read<RunSceneRow>(DSO.runScene)
    ]);
    const reel = buildReel(demos, scenes, runs, runScenes);
    if (!query?.queryInformation) return reel;
    const { filters } = extractFilterFromQueryParameters<ReelDemo>({ filter: '{}', ...query });
    if (!filters) return reel;
    const list = convertFilterToFilterList(filters);
    return reel.filter((demo) => evaluateFilterList(demo as unknown as Record<string, unknown>, list));
  }
}
