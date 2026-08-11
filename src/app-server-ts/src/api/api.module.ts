import { CoreApiModule } from '@buildone/app-server-tslib/modules';
import { Module } from '@nestjs/common';

import { RestModule } from './rest/rest.module';

@Module({
  imports: [CoreApiModule, RestModule],
  exports: [CoreApiModule, RestModule]
})
export class ApiModule {}
