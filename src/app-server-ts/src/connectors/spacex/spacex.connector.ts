import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, MethodNotAllowedException } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

import { buildSpaceXQuery } from './spacex.filter';
import { QUERYABLE_RESOURCES } from './spacex.types';

import type { SpaceXQueryResponse } from './spacex.types';
import type { IDataConnector } from '@buildone/app-server-tslib/modules';
import type { QueryObject } from '@buildone/app-server-tslib/utils';

/** Default SpaceX API base URL. Override with SPACEX_API_BASE_URL env var. */
const DEFAULT_BASE_URL = 'https://api.spacexdata.com';

/** Default API version. */
const API_VERSION = 'v4';

/**
 * SpaceX DataConnector for the B1 framework.
 *
 * Connects to the public SpaceX REST API (read-only, no authentication).
 * Queryable resources use the POST `/{resource}/query` endpoint with
 * MongoDB-style filtering. Singleton resources (company, roadster) use
 * a simple GET.
 *
 * Registered as provider `'spacex'` via ConnectorModule.forRoot().
 */
@Injectable()
export class SpaceXConnector implements IDataConnector {
  private readonly logger = new Logger(SpaceXConnector.name);
  private readonly baseUrl: string;

  constructor(private readonly httpService: HttpService) {
    this.baseUrl = process.env.SPACEX_API_BASE_URL ?? DEFAULT_BASE_URL;
  }

  async fetch(object: string, query: QueryObject<unknown>): Promise<unknown[]> {
    if (QUERYABLE_RESOURCES.has(object)) {
      return this.fetchWithQuery(object, query);
    }
    return this.fetchSingleton(object);
  }

  async create(): Promise<unknown[]> {
    throw new MethodNotAllowedException('SpaceX API is read-only');
  }

  async update(): Promise<unknown[]> {
    throw new MethodNotAllowedException('SpaceX API is read-only');
  }

  async delete(): Promise<void> {
    throw new MethodNotAllowedException('SpaceX API is read-only');
  }

  /**
   * Fetches records using the POST `/query` endpoint (MongoDB-style).
   */
  private async fetchWithQuery(resource: string, query: QueryObject<unknown>): Promise<unknown[]> {
    const url = `${this.baseUrl}/${API_VERSION}/${resource}/query`;
    const body = buildSpaceXQuery(query);

    this.logger.debug(`SpaceX query ${resource}: ${JSON.stringify(body)}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post<SpaceXQueryResponse<unknown>>(url, body, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000
        })
      );

      return response.data.docs;
    } catch (error) {
      this.logger.error(`SpaceX fetch failed for ${resource}: ${error?.message}`);
      throw error;
    }
  }

  /**
   * Fetches singleton resources (company, roadster) via GET.
   */
  private async fetchSingleton(resource: string): Promise<unknown[]> {
    const url = `${this.baseUrl}/${API_VERSION}/${resource}`;

    this.logger.debug(`SpaceX GET ${resource}`);

    try {
      const response = await firstValueFrom(this.httpService.get<unknown>(url, { timeout: 30000 }));

      // Wrap singleton response in array for consistency with IDataConnector
      return Array.isArray(response.data) ? response.data : [response.data];
    } catch (error) {
      this.logger.error(`SpaceX fetch failed for ${resource}: ${error?.message}`);
      throw error;
    }
  }
}
