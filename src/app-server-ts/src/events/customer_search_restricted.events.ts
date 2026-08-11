import { DRIZZLE } from '@buildone/app-server-tslib/drizzle';
import { RequestContext } from '@buildone/app-server-tslib/modules';
import { Inject, Injectable } from '@nestjs/common';
import { InferSelectModel, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { MelangeAuthService } from '@/auth/melange';
import { clients, salesReps } from '@/drizzle/schema';

type ClientSelectModel = InferSelectModel<typeof clients>;
type ClientCustom = ClientSelectModel & {
  _uiActions?: {
    UiAttributes: { FieldName: string; IsAnonymized: boolean }[];
  };
};

const ANONYMIZED_BALANCE = '***********';

@Injectable()
export class CustomerSearchRestrictedEvents {
  constructor(
    private readonly requestContext: RequestContext,
    private readonly melangeAuth: MelangeAuthService,

    @Inject(DRIZZLE) private readonly db: NodePgDatabase<any>
  ) {}

  async onAfterFetch(data: ClientCustom[]) {
    if (!data?.length) return;

    const userEmail = this.requestContext.user?.email;
    const allowedRepNames = await this.getAllowedRepresentativeNames(userEmail);

    for (const record of data) {
      const repName = (record.representative ?? '').trim();
      if (repName && allowedRepNames.has(repName)) continue;

      record.balance = ANONYMIZED_BALANCE;
      record._uiActions ??= { UiAttributes: [] };
      record._uiActions.UiAttributes.push({ FieldName: 'balance', IsAnonymized: true });
    }
  }

  /**
   * Resolve the set of sales_rep display names the current user is permitted to
   * view financial data for. Empty set => every balance is anonymized.
   */
  private async getAllowedRepresentativeNames(userEmail: string | undefined): Promise<Set<string>> {
    if (!userEmail) return new Set();

    const allowedIds = await this.melangeAuth.listAccessibleObjects(
      'user',
      userEmail,
      'can_see_financial_data',
      'sales_rep'
    );
    if (allowedIds.length === 0) return new Set();

    const idSet = allowedIds.map((id) => Number.parseInt(id, 10)).filter((n) => Number.isFinite(n));
    if (idSet.length === 0) return new Set();

    const rows = await this.db
      .select({
        fullName: sql<string>`${salesReps.firstName} || ' ' || ${salesReps.lastName}`
      })
      .from(salesReps)
      .where(inArray(salesReps.salesRepId, idSet));
    return new Set(rows.map((r) => r.fullName));
  }
}
