import { B1Action, B1ActionPayload, B1Service } from '@buildone/app-server-tslib';
import { DRIZZLE } from '@buildone/app-server-tslib/drizzle';
import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from 'src/drizzle/schema';

@B1Service({ basePath: 'pricing' })
export class PriceCalculation {
  constructor(@Inject(DRIZZLE) private readonly conn: NodePgDatabase<typeof schema>) {}

  @B1Action({ description: 'calculates pricing total given productId and quantity' })
  async total(payload: B1ActionPayload<{ quantity: number; productId: number }>) {
    const data = await this.conn.query.products.findFirst({
      where: eq(schema.products.productId, payload.body.productId)
    });

    if (!data) {
      return {
        error: `Product was not found for productId=${payload.body.productId}`
      };
    }

    const total = Number(data.unitPrice) * payload.body.quantity;

    return {
      message: `Successfuly calculated total for '${data.productName}' with quantity ${payload.body.quantity}.`,
      product: data,
      total
    };
  }
}
