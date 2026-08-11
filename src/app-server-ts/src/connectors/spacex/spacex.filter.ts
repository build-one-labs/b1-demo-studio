import { isFilterList } from '@buildone/app-server-tslib/utils';

import type { SpaceXQueryRequest } from './spacex.types';
import type { FilterCriteria, FilterList, Operator, OrderBy, QueryObject } from '@buildone/app-server-tslib/utils';

/**
 * Converts a single FilterCriteria into a MongoDB query condition.
 */
function criteriaToMongo(criteria: FilterCriteria): Record<string, unknown> {
  const { field, operator, value } = criteria;

  switch (operator as Operator) {
    case 'eq':
    case '=':
      return { [field]: value };

    case 'neq':
    case 'ne':
    case '<>':
      return { [field]: { $ne: value } };

    case 'gt':
    case '>':
      return { [field]: { $gt: value } };

    case 'lt':
    case '<':
      return { [field]: { $lt: value } };

    case 'gte':
    case 'ge':
    case '>=':
      return { [field]: { $gte: value } };

    case 'lte':
    case 'le':
    case '<=':
      return { [field]: { $lte: value } };

    case 'isNull':
      return value ? { [field]: null } : { [field]: { $ne: null } };

    case 'contains':
    case 'matches':
      return { [field]: { $regex: String(value ?? ''), $options: 'i' } };

    case 'notcontains':
      return { [field]: { $not: { $regex: String(value ?? ''), $options: 'i' } } };

    case 'begins':
    case 'startswith':
    case 'beginsmatches':
      return { [field]: { $regex: `^${String(value ?? '')}`, $options: 'i' } };

    case 'ends':
    case 'endswith':
      return { [field]: { $regex: `${String(value ?? '')}$`, $options: 'i' } };

    default:
      return { [field]: value };
  }
}

/**
 * Recursively converts a FilterList into a MongoDB query object.
 */
function filterListToMongo<T>(filterList: FilterList<T>): Record<string, unknown> {
  const parts = filterList.filters
    .map((entry) => {
      if (isFilterList(entry)) {
        return filterListToMongo(entry);
      }
      return criteriaToMongo(entry as FilterCriteria);
    })
    .filter((part) => Object.keys(part).length > 0);

  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];

  const logicOp = filterList.logic === 'or' ? '$or' : '$and';
  return { [logicOp]: parts };
}

/**
 * Builds a SpaceX API query request from a B1 QueryObject.
 *
 * Translates B1 filter operators to MongoDB query syntax and maps
 * orderBy, limit, and offset to the SpaceX query options.
 *
 * @param query - Normalised QueryObject with optional filters, orderBy, limit, offset
 * @returns SpaceXQueryRequest ready to POST to `/{resource}/query`
 */
export function buildSpaceXQuery(query: QueryObject<unknown>): SpaceXQueryRequest {
  let mongoQuery: Record<string, unknown> = {};

  if (query.filters) {
    if (isFilterList(query.filters)) {
      mongoQuery = filterListToMongo(query.filters);
    } else {
      // Simple key-value filter
      mongoQuery = { ...query.filters } as Record<string, unknown>;
    }
  }

  const options: SpaceXQueryRequest['options'] = {};

  if (query.limit !== null && query.limit !== undefined) {
    options.limit = query.limit;
  }

  if (query.offset !== null && query.offset !== undefined) {
    options.offset = query.offset;
  }

  if (query.orderBy) {
    const { field, order } = query.orderBy as OrderBy<unknown>;
    options.sort = { [field as string]: order === 'desc' ? -1 : 1 };
  }

  return { query: mongoQuery, options };
}
