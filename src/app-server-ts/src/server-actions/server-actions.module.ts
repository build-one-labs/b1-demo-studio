import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { ApiModule } from '../api/api.module';

import { DemoFactoryStudio } from './demo-factory/demo-factory.actions';
import {
  DemoFactoryHostEvents,
  DemoFactorySettingEvents,
  DemoFactoryStageEvents
} from './demo-factory/demo-factory.events';
import { DemoFactoryHost } from './demo-factory/demo-factory.host';
import { DemoFactoryMaterializer } from './demo-factory/demo-factory.materializer';
import { DemoFactoryMedia } from './demo-factory/demo-factory.media.controller';
import { DemoFactoryNarrationCache } from './demo-factory/demo-factory.narration-cache';
import { DemoFactoryRunIngest } from './demo-factory/demo-factory.run-ingest';
import { DemoFactorySeedService } from './demo-factory/demo-factory.seed';
import { DemoFactoryStore } from './demo-factory/demo-factory.store';
import { DemoFactoryTransfer } from './demo-factory/demo-factory.transfer';
import { PriceCalculation } from './samples/price-calculation';
import { Weather } from './samples/weather';

/**
 * `ApiModule` is imported for `ClobService`, which reaches here through
 * CoreApiModule's re-export of `ClobModule`. It is what lets the Demo Factory's
 * services read and write their own data sources in-process instead of calling
 * this server's own HTTP routes.
 *
 * The event handlers are registered under **string tokens** as well as their
 * classes: a data source names its `serverEventsHandler` by name, and the
 * framework resolves that name with `moduleRef.get(name, { strict: false })` —
 * the same convention as `EventsModule`. The class registration is what the
 * Studio's own services inject.
 */
const HANDLERS = [
  { provide: 'DemoFactoryMaterializer', useExisting: DemoFactoryMaterializer },
  { provide: 'DemoFactorySettingEvents', useExisting: DemoFactorySettingEvents },
  { provide: 'DemoFactoryStageEvents', useExisting: DemoFactoryStageEvents },
  { provide: 'DemoFactoryHostEvents', useExisting: DemoFactoryHostEvents }
];

@Module({
  imports: [HttpModule, ApiModule],
  controllers: [Weather, PriceCalculation, DemoFactoryStudio, DemoFactoryMedia],
  providers: [
    DemoFactoryHost,
    DemoFactoryStore,
    DemoFactoryMaterializer,
    DemoFactoryRunIngest,
    DemoFactorySeedService,
    DemoFactoryTransfer,
    DemoFactoryNarrationCache,
    DemoFactorySettingEvents,
    DemoFactoryStageEvents,
    DemoFactoryHostEvents,
    ...HANDLERS
  ],
  exports: [
    DemoFactoryHost,
    DemoFactoryStore,
    DemoFactoryMaterializer,
    DemoFactoryRunIngest,
    DemoFactorySeedService,
    ...HANDLERS.map((handler) => handler.provide)
  ]
})
export class ServerActionsModule {}
