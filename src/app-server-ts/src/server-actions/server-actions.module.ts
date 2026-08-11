import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { PriceCalculation } from './samples/price-calculation';
import { Weather } from './samples/weather';

@Module({
  imports: [HttpModule],
  controllers: [Weather, PriceCalculation]
})
export class ServerActionsModule {}
