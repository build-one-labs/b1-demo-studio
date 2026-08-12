import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { DemoFactoryStudio } from './demo-factory/demo-factory.actions';
import { DemoFactoryMedia } from './demo-factory/demo-factory.media.controller';
import { PriceCalculation } from './samples/price-calculation';
import { Weather } from './samples/weather';

@Module({
  imports: [HttpModule],
  controllers: [Weather, PriceCalculation, DemoFactoryStudio, DemoFactoryMedia]
})
export class ServerActionsModule {}
