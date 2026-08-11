import { RequestContext } from '@buildone/app-server-tslib/modules';
import { Injectable } from '@nestjs/common';

import { MelangeAuthService } from '@/auth/melange';

interface OpportunityRecord {
  Id?: string;
  Amount?: number | string | null;
  reference_number__c?: string | null;
  _uiActions?: {
    UiAttributes: { FieldName: string; IsAnonymized: boolean }[];
  };
}

const ANONYMIZED_AMOUNT = '***********';

/**
 * Mirrors {@link CustomerSearchRestrictedEvents}: anonymizes the financial
 * field on records the user can't see.
 *
 * Salesforce Opportunity carries `reference_number__c` which IS the sales rep
 * number (no name lookup, unlike `clients.representative` which holds a
 * full-name string). We resolve the user's allowed sales rep IDs via Melange
 * and replace `Amount` with stars on every record whose `reference_number__c`
 * isn't in the allowed set.
 */
@Injectable()
export class SalesforceOpportunityRestrictedEvents {
  constructor(
    private readonly requestContext: RequestContext,
    private readonly melangeAuth: MelangeAuthService
  ) {}

  async onAfterFetch(data: OpportunityRecord[]) {
    if (!data?.length) return;

    const allowedSalesRepIds = await this.getAllowedSalesRepIds(this.requestContext.user?.email);

    for (const record of data) {
      const refNumber = (record.reference_number__c ?? '').toString().trim();
      if (refNumber && allowedSalesRepIds.has(refNumber)) continue;

      record.Amount = ANONYMIZED_AMOUNT;
      record._uiActions ??= { UiAttributes: [] };
      record._uiActions.UiAttributes.push({ FieldName: 'Amount', IsAnonymized: true });
    }
  }

  /**
   * Sales rep IDs the current user is permitted to view financial data for.
   * Empty set => every Amount is anonymized.
   */
  private async getAllowedSalesRepIds(userEmail: string | undefined): Promise<Set<string>> {
    if (!userEmail) return new Set();
    const allowedIds = await this.melangeAuth.listAccessibleObjects(
      'user',
      userEmail,
      'can_see_financial_data',
      'sales_rep'
    );
    return new Set(allowedIds);
  }
}
