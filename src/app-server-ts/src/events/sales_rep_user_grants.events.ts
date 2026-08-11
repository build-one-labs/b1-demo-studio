import { Injectable } from '@nestjs/common';

@Injectable()
export class SalesRepUserGrantsEvents {
  onBeforeCreate(record: Record<string, unknown>) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (value !== null && value !== undefined && value !== '') cleaned[key] = value;
    }
    return cleaned;
  }
}
