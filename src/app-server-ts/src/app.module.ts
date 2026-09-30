import { DrizzleModule } from '@buildone/app-server-tslib/drizzle';
import { FrameworkModule } from '@buildone/app-server-tslib/framework';
import { ApplicationSettingsModule, ConnectorModule, RequestContextModule } from '@buildone/app-server-tslib/modules';
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';

import { ApiModule } from './api/api.module';
import appSettingsConfig from './app-settings.config';
import { MelangeAuthModule } from './auth/melange';
import { SalesforceConnector } from './connectors/salesforce/salesforce.connector';
import { SpaceXConnector } from './connectors/spacex/spacex.connector';
import * as schema from './drizzle/schema';
import { EventsModule } from './events/events.module';
import { ServerActionsModule } from './server-actions/server-actions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ApplicationSettingsModule.forRoot({
      configs: [appSettingsConfig]
    }),
    DrizzleModule.forRoot({
      global: true,
      schema,
      database: {
        configKey: 'APP_DATABASE_URL',
        ssl: true
      }
    }),
    RequestContextModule,
    MelangeAuthModule,
    HttpModule,
    ConnectorModule.forRoot({
      connectors: [
        { provide: 'salesforce', useClass: SalesforceConnector },
        { provide: 'spacex', useClass: SpaceXConnector }
      ],
      imports: [HttpModule]
    }),
    EventsModule,
    DiscoveryModule,
    ApiModule,
    ServerActionsModule,
    FrameworkModule
  ]
})
export class AppModule {}
