import { DataService } from '@buildone/app-server-tslib/modules';
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';

interface RestQuery {
  offset?: number;
  limit?: number;
  filter?: string;
}

@Controller('rest')
export class RestController {
  constructor(private readonly dataService: DataService) {}

  @Get(':entity')
  getAllRecords(@Param('entity') entity: string, @Query() query: RestQuery) {
    return this.dataService.getData({
      entity,
      queryParams: {
        filter: JSON.stringify({
          top: query.limit ? Number(query.limit) : 50,
          skip: query.offset ? Number(query.offset) : 0
        }),
        queryInformation: query.filter
      }
    });
  }

  @Get(':entity/:id')
  getRecordById(@Param('entity') entity: string, @Param('id') id: string) {
    // Build a filter for the specific ID
    const queryInformation = JSON.stringify({
      fieldlist: '*',
      filters: {
        logic: 'and',
        filters: [
          {
            field: 'id',
            operator: 'eq',
            value: parseInt(id, 10)
          }
        ]
      }
    });

    return this.dataService.getData({
      entity,
      queryParams: { queryInformation, filter: JSON.stringify({ top: 1, skip: 0 }) }
    });
  }

  @Post(':entity')
  createRecord(@Param('entity') entity: string, @Body() data: Record<string, unknown>) {
    return this.dataService.createData({ entity, data });
  }

  @Put(':entity/:id')
  updateRecord(@Param('entity') entity: string, @Param('id') id: string, @Body() data: Record<string, unknown>) {
    // Ensure the ID in the path matches the data
    const recordData = { ...data, id: parseInt(id, 10) };
    return this.dataService.updateData({ entity, data: recordData });
  }

  @Delete(':entity/:id')
  deleteRecord(@Param('entity') entity: string, @Param('id') id: string) {
    const data = { id: parseInt(id, 10) };
    return this.dataService.deleteData({ entity, data });
  }

  @Post(':entity/commit')
  commitRecords(
    @Param('entity') entity: string,
    @Body()
    body: {
      createdRecords: Record<string, unknown>[];
      updatedRecords: Record<string, unknown>[];
      deletedRecords: Record<string, unknown>[];
    }
  ) {
    return this.dataService.commitData({
      entity,
      createdRecords: body.createdRecords,
      updatedRecords: body.updatedRecords,
      deletedRecords: body.deletedRecords
    });
  }
}
