import { Global, Module } from '@nestjs/common';

import { MelangeAuthService } from './melange-auth.service';

// NOTE: Intentionally NOT registering MelangeAuthService under AUTHORIZATION_SERVICE.
// The tslib DataService would otherwise call its authorization hooks on every
// row of every DSO, but the app DB's FGA model is sales_rep-scoped, so every
// check would miss and DataService would silently drop every record.
// Melange here is used only for targeted field-level masking via direct
// injection of MelangeAuthService.
@Global()
@Module({
  providers: [MelangeAuthService],
  exports: [MelangeAuthService]
})
export class MelangeAuthModule {}
