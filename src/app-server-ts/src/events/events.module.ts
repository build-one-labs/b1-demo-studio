import { Module, Global } from '@nestjs/common';

import { CustomerSearchRestrictedEvents } from './customer_search_restricted.events';
import { SalesRepUserGrantsEvents } from './sales_rep_user_grants.events';
import { SalesRepsEvents } from './sales_reps.events';
import { SalesforceOpportunityRestrictedEvents } from './salesforce_opportunity_restricted.events';
import { InvoiceEvents } from './sample_inv.events';
import { ProductEvents } from './sample_prd.events';

@Global()
@Module({
  providers: [
    {
      provide: 'InvoiceEvents',
      useClass: InvoiceEvents
    },
    {
      provide: 'ProductEvents',
      useClass: ProductEvents
    },
    {
      provide: 'CustomerSearchRestrictedEvents',
      useClass: CustomerSearchRestrictedEvents
    },
    {
      provide: 'SalesforceOpportunityRestrictedEvents',
      useClass: SalesforceOpportunityRestrictedEvents
    },
    {
      provide: 'SalesRepsEvents',
      useClass: SalesRepsEvents
    },
    {
      provide: 'SalesRepUserGrantsEvents',
      useClass: SalesRepUserGrantsEvents
    }
  ]
})
export class EventsModule {}
