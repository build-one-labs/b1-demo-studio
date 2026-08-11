import { Injectable } from '@nestjs/common';
import { InferSelectModel } from 'drizzle-orm';

import { salesReps } from '@/drizzle/schema';

type SalesRepSelectModel = InferSelectModel<typeof salesReps>;
type SalesRepWithFullName = SalesRepSelectModel & { fullName?: string };

@Injectable()
export class SalesRepsEvents {
  onAfterFetch(data: SalesRepWithFullName[]) {
    for (const rep of data) {
      rep.fullName = `${rep.firstName ?? ''} ${rep.lastName ?? ''}`.trim();
    }
  }
}
