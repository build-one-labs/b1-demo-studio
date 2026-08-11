/**
 * Base shape for any Salesforce SObject record.
 * All records returned by the Salesforce REST API include an `Id` field.
 */
export interface SalesforceRecord {
  Id: string;
  [key: string]: unknown;
}

/**
 * Response envelope from the Salesforce Query API.
 */
export interface SalesforceQueryResult<T = SalesforceRecord> {
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
  records: T[];
}

/**
 * Response from the Salesforce OAuth 2.0 token endpoint.
 */
export interface SalesforceTokenResponse {
  access_token: string;
  instance_url: string;
  id: string;
  token_type: string;
  issued_at: string;
  signature: string;
}

/**
 * Result shape returned by Salesforce single-record write operations (create/update).
 */
export interface SalesforceWriteResult {
  id: string;
  success: boolean;
  errors: string[];
}

/**
 * Salesforce describe field metadata (partial, sufficient for type detection).
 */
export interface SalesforceFieldDescribe {
  name: string;
  type: string;
  label: string;
  updateable: boolean;
  createable: boolean;
}

/**
 * Partial Salesforce SObject describe result.
 */
export interface SalesforceDescribeResult {
  name: string;
  fields: SalesforceFieldDescribe[];
}

/**
 * Cached token entry stored in memory.
 */
export interface CachedToken {
  accessToken: string;
  instanceUrl: string;
  /** Epoch ms after which the token should be refreshed */
  expiresAt: number;
}
