import { Injectable } from '@nestjs/common';
import { InferSelectModel } from 'drizzle-orm';

import { invoices } from '@/drizzle/schema';

type InvoiceSelectModel = InferSelectModel<typeof invoices>;
type InvoiceCustom = InvoiceSelectModel & {
  _uiActions: {
    UiAttributes: { FieldName: string; IsAnonymized: boolean }[];
  };
};

@Injectable()
export class InvoiceEvents {
  onAfterFetch(data: InvoiceCustom[]) {
    data.forEach((invoice) => {
      invoice.totalAmount = 'custom calculation: ' + String(Math.random() * 100);
    });
  }
}
