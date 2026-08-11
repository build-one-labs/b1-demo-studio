/**
 * Type definitions for the SpaceX API connector.
 *
 * The SpaceX API uses a MongoDB-style POST `/query` endpoint
 * for filtering and pagination on most resources.
 */

/** Resources that support the POST `/{resource}/query` endpoint. */
export const QUERYABLE_RESOURCES = new Set([
  'launches',
  'rockets',
  'capsules',
  'cores',
  'crew',
  'dragons',
  'history',
  'launchpads',
  'landpads',
  'payloads',
  'ships',
  'starlink'
]);

/** Body sent to POST `/{resource}/query`. */
export interface SpaceXQueryRequest {
  query: Record<string, unknown>;
  options: SpaceXQueryOptions;
}

/** Pagination/sort options inside the query request. */
export interface SpaceXQueryOptions {
  limit?: number;
  offset?: number;
  sort?: Record<string, 1 | -1>;
  select?: string[];
}

/** Paginated response envelope returned by the `/query` endpoint. */
export interface SpaceXQueryResponse<T> {
  docs: T[];
  totalDocs: number;
  limit: number;
  offset: number;
  totalPages: number;
  page: number;
  pagingCounter: number;
  hasPrevPage: boolean;
  hasNextPage: boolean;
  prevPage: number | null;
  nextPage: number | null;
}
