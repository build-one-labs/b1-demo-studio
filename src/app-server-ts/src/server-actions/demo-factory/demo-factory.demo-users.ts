/**
 * Demo users: the accounts Playwright signs in as in the target applications.
 *
 * A Studio user signs in to the Studio as themselves; a recording signs in as
 * the demo's demo user — usually a dedicated account with demo data. A demo
 * picks one by id (`settings.demoUser`); the row in DemoFactoryDemoUserDSO
 * holds its label and the application it is meant for, and its credential —
 * an API key of that account — lives in the secret store at organization
 * level as `demo-factory-user-<id>`. It is written once (save-demo-user, as
 * the person saving it, who must be allowed to write organization secrets),
 * read only by the server when a job starts, and handed to that job alone.
 */
import { RequestContext, SecretResolver } from '@buildone/app-server-tslib/modules';
import { IServerEventsHandler } from '@buildone/app-server-tslib/utils';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';

import { authHostSlug } from './demo-factory.lib';

export interface DemoUserRow {
  id: string;
  label: string;
  /** The application this user is meant for — a hint for authors, not enforced. */
  appUrl: string;
  /** Whether the secret store holds the user's key — filled on every read, never stored. */
  configured: boolean;
  updatedAt: string | null;
  /** The label again, under the name the "Sign in as" select displays — filled on read. */
  demoUserLabel?: string;
}

export const DEMO_USER_ID_PATTERN = /^[\da-z][\da-z-]{0,48}$/;

/** The secret a demo user's API key is stored under. */
export const demoUserSecretName = (id: string): string => `demo-factory-user-${id}`;

/**
 * The environment a job gets for a demo user: the key under both names the
 * pipeline looks up — the scoped `B1_USER_API_KEY__<AUTH HOST>` wins over the
 * plain one in env.mjs and browser-session.mjs, so setting only the plain one
 * would leave a host key in charge — and its own auth-state file, so a take
 * never reuses another user's session.
 */
export const demoUserJobEnv = (
  id: string,
  apiKey: string,
  { authUrl = process.env.AUTH_URL, authStateFile }: { authUrl?: string; authStateFile: string }
): Record<string, string> => {
  const slug = authHostSlug(authUrl);
  return {
    B1_USER_API_KEY: apiKey,
    ...(slug ? { [`B1_USER_API_KEY__${slug}`]: apiKey } : {}),
    B1_AUTH_STATE: authStateFile,
    DEMO_USER: id
  };
};

@Injectable()
export class DemoFactoryDemoUsers {
  private readonly logger = new Logger(DemoFactoryDemoUsers.name);

  constructor(
    private readonly secrets: SecretResolver,
    private readonly ctx: RequestContext,
    private readonly http: HttpService
  ) {}

  /** The user's key, as the caller sees the store; undefined when it is not stored. */
  async apiKey(id: string): Promise<string | undefined> {
    if (!DEMO_USER_ID_PATTERN.test(id)) return undefined;
    return (await this.secrets.resolve(demoUserSecretName(id))) || undefined;
  }

  /**
   * Write (or, with an empty key, delete) the user's key at organization level,
   * as the caller — the store decides whether they may. Forwards only the
   * caller's own credentials, never anything of this server's.
   */
  async storeApiKey(id: string, apiKey: string | null): Promise<void> {
    const authUrl = (process.env.B1_STACK_AUTH_URL || process.env.AUTH_URL || '').replace(/\/+$/, '');
    if (!authUrl) throw new Error('No AUTH_URL on this server — the secret store is unknown');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const incoming = this.ctx.req?.headers ?? {};
    for (const name of ['cookie', 'authorization', 'x-api-key']) {
      const value = incoming[name];
      if (typeof value === 'string' && value) headers[name] = value;
    }
    const url = `${authUrl}/api/secrets/org/key/${encodeURIComponent(demoUserSecretName(id))}`;
    const response = await this.http.axiosRef.request({
      url,
      method: apiKey ? 'POST' : 'DELETE',
      headers,
      data: apiKey ? { secret: apiKey } : undefined,
      timeout: 30_000,
      validateStatus: () => true
    });
    if (response.status < 300 || (!apiKey && response.status === 404)) return;
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `The secret store refused (${response.status}): only an owner or admin of the organization may store a demo user's key. ` +
          `Ask one, or store ${demoUserSecretName(id)} in the auth console under Secrets → Organization.`
      );
    }
    const detail = JSON.stringify(response.data ?? '').slice(0, 200);
    this.logger.warn(`Storing ${demoUserSecretName(id)} failed: ${response.status} ${detail}`);
    throw new Error(`The secret store answered ${response.status} — the key was not stored`);
  }
}

/** `configured` is the store's truth, looked up on every read; nothing secret is ever in the payload. */
@Injectable()
export class DemoFactoryDemoUserEvents implements IServerEventsHandler<DemoUserRow> {
  constructor(private readonly users: DemoFactoryDemoUsers) {}

  async onAfterFetch(records: DemoUserRow[]): Promise<void> {
    await Promise.all(
      records.map(async (record) => {
        record.configured = Boolean(await this.users.apiKey(record.id));
        record.demoUserLabel = record.label || record.id;
      })
    );
  }

  onBeforeCreate(record: DemoUserRow): DemoUserRow {
    return this.stored(record);
  }

  onBeforeUpdate(record: DemoUserRow): DemoUserRow {
    return this.stored(record);
  }

  /** Only what the row holds: `configured` and `demoUserLabel` are read-time answers. */
  private stored({ demoUserLabel: _shown, ...record }: DemoUserRow): DemoUserRow {
    return { ...record, configured: false };
  }
}
