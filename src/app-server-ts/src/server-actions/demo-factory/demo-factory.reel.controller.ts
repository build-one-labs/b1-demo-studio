import { type IServerDataSourceReadable } from '@buildone/app-server-tslib/modules';
import { Controller, Get } from '@nestjs/common';

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
 * assembled from four data sources, so there is no table to page in.
 */
@Controller('demo-factory/reel')
export class DemoFactoryReel implements IServerDataSourceReadable<ReelDemo> {
  constructor(
    private readonly store: DemoFactoryStore,
    private readonly seed: DemoFactorySeedService
  ) {}

  @Get()
  async fetch(): Promise<ReelDemo[]> {
    await this.seed.ensureReconciled();
    const [demos, scenes, runs, runScenes] = await Promise.all([
      this.store.read<DemoRow>(DSO.demo),
      this.store.read<SceneRow>(DSO.scene),
      this.store.read<RunRow>(DSO.run),
      this.store.read<RunSceneRow>(DSO.runScene)
    ]);
    return buildReel(demos, scenes, runs, runScenes);
  }
}
