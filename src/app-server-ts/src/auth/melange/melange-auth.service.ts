import { PG_POOL } from '@buildone/app-server-tslib/drizzle';
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

export interface CheckPermissionOptions {
  subjectType: string;
  subjectId: string;
  relation: string;
  objectType: string;
  objectId: string;
}

@Injectable()
export class MelangeAuthService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async checkPermission(options: CheckPermissionOptions): Promise<boolean> {
    const { subjectType, subjectId, relation, objectType, objectId } = options;
    const result = await this.pool.query('SELECT check_permission($1, $2, $3, $4, $5) AS allowed', [
      subjectType,
      subjectId,
      relation,
      objectType,
      objectId
    ]);
    return result.rows[0]?.allowed === 1;
  }

  async checkUserPermission(
    userEmail: string,
    relation: string,
    objectType: string,
    objectId: string
  ): Promise<boolean> {
    return this.checkPermission({
      subjectType: 'user',
      subjectId: userEmail,
      relation,
      objectType,
      objectId
    });
  }

  async listAccessibleObjects(
    subjectType: string,
    subjectId: string,
    relation: string,
    objectType: string
  ): Promise<string[]> {
    const result = await this.pool.query('SELECT * FROM list_accessible_objects($1, $2, $3, $4)', [
      subjectType,
      subjectId,
      relation,
      objectType
    ]);
    return result.rows.map((r) => r.object_id);
  }

  async listAccessibleSubjects(
    subjectType: string,
    relation: string,
    objectType: string,
    objectId: string
  ): Promise<string[]> {
    const result = await this.pool.query('SELECT * FROM list_accessible_subjects($1, $2, $3, $4)', [
      subjectType,
      relation,
      objectType,
      objectId
    ]);
    return result.rows.map((r) => r.subject_id);
  }
}
