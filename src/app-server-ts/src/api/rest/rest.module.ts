import { CoreApiModule } from '@buildone/app-server-tslib/modules';
import { Module } from '@nestjs/common';

import { RestController } from './rest.controller';

@Module({
  controllers: [RestController],
  imports: [CoreApiModule]
})
export class RestModule {}
