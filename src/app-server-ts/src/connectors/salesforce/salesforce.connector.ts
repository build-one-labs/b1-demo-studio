import { buildSoqlQuery } from '@buildone/app-server-tslib/utils';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

import type {
  CachedToken,
  SalesforceDescribeResult,
  SalesforceFieldDescribe,
  SalesforceQueryResult,
  SalesforceRecord,
  SalesforceTokenResponse,
  SalesforceWriteResult
} from './salesforce.types';
import type { IDataConnector } from '@buildone/app-server-tslib/modules';
import type { QueryObject } from '@buildone/app-server-tslib/utils';

/** Salesforce REST API version */
const SF_API_VERSION = 'v59.0';

/** Token lifetime assumption in ms (Salesforce tokens default to 2h; we refresh after 90 min) */
const TOKEN_TTL_MS = 90 * 60 * 1000;

/**
 * Built-in Salesforce DataConnector for the B1 framework.
 *
 * Connects to Salesforce via OAuth 2.0 Client Credentials flow.
 * The Connected App must have "Enable Client Credentials Flow" checked
 * and a "Run As" user configured in Salesforce Setup.
 *
 * | Variable | Description |
 * |---|---|
 * | `SALESFORCE_INSTANCE_URL` | e.g. `https://yourorg.my.salesforce.com` |
 * | `SALESFORCE_CLIENT_ID` | Connected App Consumer Key |
 * | `SALESFORCE_CLIENT_SECRET` | Connected App Consumer Secret |
 *
 * The access token is cached in memory and refreshed automatically on expiry or 401.
 *
 * Registered as provider `'salesforce'` via ConnectorModule.forRoot().
 */
@Injectable()
export class SalesforceConnector implements IDataConnector {
  private readonly logger = new Logger(SalesforceConnector.name);
  private cachedToken: CachedToken | null = null;

  /** Cache of field lists per SObject, populated on first describe call */
  private readonly fieldCache = new Map<string, string>();

  /** Cache of full field describe metadata per SObject */
  private readonly describeCache = new Map<string, SalesforceFieldDescribe[]>();

  constructor(private readonly httpService: HttpService) {}

  // ---------------------------------------------------------------------------
  // IDataConnector implementation
  // ---------------------------------------------------------------------------

  async fetch(object: string, query: QueryObject<unknown>): Promise<unknown[]> {
    const fields = await this.getFieldList(object, query);
    const soql = buildSoqlQuery(object, fields, query);

    this.logger.debug(`SOQL: ${soql}`);

    const { accessToken, instanceUrl } = await this.getToken();
    const url = `${instanceUrl}/services/data/${SF_API_VERSION}/query`;

    try {
      const response = await firstValueFrom(
        this.httpService.get<SalesforceQueryResult>(url, {
          headers: this.authHeaders(accessToken),
          params: { q: soql },
          timeout: 30000
        })
      );

      return response.data.records.map(this.stripAttributes);
    } catch (error) {
      if (error?.response?.status === 401) {
        this.cachedToken = null;
        return this.fetch(object, query);
      }
      this.logger.error(`Salesforce fetch failed: ${error?.message}`);
      throw error;
    }
  }

  async create(object: string, records: Record<string, unknown>[]): Promise<unknown[]> {
    const { accessToken, instanceUrl } = await this.getToken();
    const url = `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${object}`;
    const created: SalesforceRecord[] = [];
    const createableFields = await this.getCreateableFieldNames(object);

    for (const record of records) {
      const filteredRecord = createableFields ? this.pickFields(record, createableFields) : record;

      try {
        const response = await firstValueFrom(
          this.httpService.post<SalesforceWriteResult>(url, filteredRecord, {
            headers: this.authHeaders(accessToken),
            timeout: 30000
          })
        );
        created.push({ ...record, Id: response.data.id } as SalesforceRecord);
      } catch (error) {
        if (error?.response?.status === 401) {
          this.cachedToken = null;
          return this.create(object, records);
        }
        this.logger.error(`Salesforce create failed: ${error?.message}`);
        throw error;
      }
    }

    return created;
  }

  async update(object: string, records: Record<string, unknown>[]): Promise<unknown[]> {
    const { accessToken, instanceUrl } = await this.getToken();
    const updated: unknown[] = [];
    const updateableFields = await this.getUpdateableFieldNames(object);

    for (const record of records) {
      const { Id, id, ...allFields } = record as SalesforceRecord & { id?: string };
      const recordId = Id ?? id;

      if (!recordId) {
        throw new Error(`Cannot update ${object} record without an Id`);
      }

      // Filter out non-updateable fields (formula, system, read-only)
      const fields = updateableFields ? this.pickFields(allFields, updateableFields) : allFields;

      const url = `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${object}/${recordId}`;

      try {
        await firstValueFrom(
          this.httpService.patch(url, fields, {
            headers: this.authHeaders(accessToken),
            timeout: 30000
          })
        );
        updated.push(record);
      } catch (error) {
        if (error?.response?.status === 401) {
          this.cachedToken = null;
          return this.update(object, records);
        }
        this.logger.error(`Salesforce update failed for ${recordId}: ${error?.message}`);
        throw error;
      }
    }

    return updated;
  }

  async delete(object: string, ids: string[]): Promise<void> {
    const { accessToken, instanceUrl } = await this.getToken();

    for (const id of ids) {
      const url = `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${object}/${id}`;

      try {
        await firstValueFrom(
          this.httpService.delete(url, {
            headers: this.authHeaders(accessToken),
            timeout: 30000
          })
        );
      } catch (error) {
        if (error?.response?.status === 401) {
          this.cachedToken = null;
          return this.delete(object, ids);
        }
        this.logger.error(`Salesforce delete failed for ${id}: ${error?.message}`);
        throw error;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  /**
   * Returns a valid access token, fetching a new one if the cache is stale.
   */
  private async getToken(): Promise<CachedToken> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken;
    }
    return this.authenticate();
  }

  /**
   * Authenticates with Salesforce using the OAuth 2.0 Client Credentials flow.
   */
  private async authenticate(): Promise<CachedToken> {
    const instanceUrl = process.env.SALESFORCE_INSTANCE_URL;
    const clientId = process.env.SALESFORCE_CLIENT_ID;
    const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;

    if (!instanceUrl || !clientId || !clientSecret) {
      throw new Error(
        'Salesforce credentials are not configured. ' +
          'Set SALESFORCE_INSTANCE_URL, SALESFORCE_CLIENT_ID, and SALESFORCE_CLIENT_SECRET.'
      );
    }

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    });

    const tokenUrl = `${instanceUrl}/services/oauth2/token`;
    this.logger.debug('Requesting Salesforce access token...');

    const response = await firstValueFrom(
      this.httpService.post<SalesforceTokenResponse>(tokenUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000
      })
    );

    this.cachedToken = {
      accessToken: response.data.access_token,
      instanceUrl: response.data.instance_url,
      expiresAt: Date.now() + TOKEN_TTL_MS
    };

    this.logger.log(`Salesforce authenticated (instance: ${response.data.instance_url})`);
    return this.cachedToken;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private authHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Determines the field list for a SOQL query.
   *
   * Priority:
   * 1. `queryInformation.fieldlist` from the query (if set by the DataSource)
   * 2. Cached describe result for the object
   * 3. Salesforce describe API call (result cached per object)
   * 4. Fallback: `FIELDS(ALL)` (max 200 records, all SF editions)
   */
  private async getFieldList(object: string, query: QueryObject<unknown>): Promise<string> {
    // The queryInformation fieldlist may carry a comma-separated list from the blueprint.
    // '*' is the B1 wildcard meaning "all fields" — ignore it and use the describe API instead.
    const fromQuery = (query as { fieldlist?: string }).fieldlist;
    if (fromQuery && fromQuery !== '*') return fromQuery;

    const cached = this.fieldCache.get(object);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const fields = await this.getDescribe(object);
      const fieldList = fields.map((f) => f.name).join(', ');
      this.fieldCache.set(object, fieldList);
      return fieldList;
    } catch {
      this.logger.warn(`Could not describe ${object}, falling back to FIELDS(ALL)`);
      return 'FIELDS(ALL)';
    }
  }

  /**
   * Returns cached describe metadata for an SObject, fetching it if not yet cached.
   */
  private async getDescribe(object: string): Promise<SalesforceFieldDescribe[]> {
    const cached = this.describeCache.get(object);
    if (cached !== undefined) {
      return cached;
    }
    const fields = await this.describeObject(object);
    this.describeCache.set(object, fields);
    return fields;
  }

  /**
   * Returns the set of updateable field names for an SObject, or null if describe fails.
   */
  private async getUpdateableFieldNames(object: string): Promise<Set<string> | null> {
    try {
      const fields = await this.getDescribe(object);
      return new Set(fields.filter((f) => f.updateable).map((f) => f.name));
    } catch {
      this.logger.warn(`Could not determine updateable fields for ${object}, sending all fields`);
      return null;
    }
  }

  /**
   * Returns the set of createable field names for an SObject, or null if describe fails.
   */
  private async getCreateableFieldNames(object: string): Promise<Set<string> | null> {
    try {
      const fields = await this.getDescribe(object);
      return new Set(fields.filter((f) => f.createable).map((f) => f.name));
    } catch {
      this.logger.warn(`Could not determine createable fields for ${object}, sending all fields`);
      return null;
    }
  }

  /**
   * Returns a new object containing only the keys present in the allowed set.
   */
  private pickFields(record: Record<string, unknown>, allowed: Set<string>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(record).filter(([key]) => allowed.has(key)));
  }

  /**
   * Fetches field metadata for a Salesforce SObject.
   * Only returns fields that are not compound (e.g. skips Address compound field).
   */
  private async describeObject(object: string): Promise<SalesforceFieldDescribe[]> {
    const { accessToken, instanceUrl } = await this.getToken();
    const url = `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${object}/describe`;

    const response = await firstValueFrom(
      this.httpService.get<SalesforceDescribeResult>(url, {
        headers: this.authHeaders(accessToken),
        timeout: 30000
      })
    );

    // Filter out compound fields (type = 'address', 'location') which cannot be used in SOQL SELECT
    return response.data.fields.filter((f) => f.type !== 'address' && f.type !== 'location');
  }

  /**
   * Removes the `attributes` field that Salesforce injects into every record.
   */
  private stripAttributes(record: SalesforceRecord): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { attributes, ...rest } = record as SalesforceRecord & { attributes?: unknown };
    return rest;
  }
}
