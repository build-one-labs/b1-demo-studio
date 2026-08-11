CREATE TABLE "sales_rep_user_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_email" varchar(255) NOT NULL,
	"sales_rep_id" integer NOT NULL,
	"relation" varchar(50) DEFAULT 'finance_viewer' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_rep_user_grants_user_rep_relation_unique" UNIQUE("user_email","sales_rep_id","relation")
);
--> statement-breakpoint
ALTER TABLE "sales_rep_user_grants" ADD CONSTRAINT "sales_rep_user_grants_sales_rep_fkey" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("sales_rep_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Indexes tuned for the melange_tuples view below.
CREATE INDEX IF NOT EXISTS idx_sales_rep_user_grants_user
  ON sales_rep_user_grants (user_email);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sales_rep_user_grants_rep
  ON sales_rep_user_grants (sales_rep_id);
--> statement-breakpoint
-- Expression index for the ::text cast used in melange_tuples.
CREATE INDEX IF NOT EXISTS idx_sales_rep_user_grants_rep_text
  ON sales_rep_user_grants ((sales_rep_id::text));
--> statement-breakpoint

-- Bridge view: maps sales_rep_user_grants rows to the 5-column tuple shape FGA expects.
-- Subjects are session users (by email); objects are sales_rep rows (by sales_rep_id).
CREATE OR REPLACE VIEW melange_tuples AS
  SELECT
    'user'::text           AS subject_type,
    g.user_email::text     AS subject_id,
    g.relation::text       AS relation,
    'sales_rep'::text      AS object_type,
    g.sales_rep_id::text   AS object_id
  FROM sales_rep_user_grants g;
--> statement-breakpoint

-- Begin Melange-generated FGA functions (v0.8.1, compiled from src/auth/fga/model.fga)
-- Melange Migration (dry-run)
-- Melange version: 0.8.1
-- Schema checksum: e662fa93e8e5a7951b8760f6bd0ee08be19f23af6816c506756ba65980ed80c6
-- Codegen version: 0.8.1

-- ============================================================
-- Database schema: public
-- NOTE: You must create this schema before running the migration:
--   CREATE SCHEMA IF NOT EXISTS "public";
-- ============================================================

-- ============================================================
-- DDL: Migration Tracking Table
-- ============================================================

-- Melange migrations tracking table
-- Stores migration history for change detection and orphan cleanup.
--
-- Each row represents a completed migration:
-- - melange_version: Version of the melange CLI/library (e.g., "v0.4.3")
-- - schema_checksum: SHA256 of the schema.fga content
-- - codegen_version: Version of the SQL generation logic
-- - function_names: All generated function names (for orphan detection)
--
-- The migrator checks the most recent record to determine if re-migration
-- is needed. If both checksum and codegen_version match, migration is skipped
-- unless --force is specified.

CREATE TABLE IF NOT EXISTS "public"."melange_migrations" (
    id SERIAL PRIMARY KEY,
    migrated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    melange_version VARCHAR(64) NOT NULL DEFAULT '',
    schema_checksum VARCHAR(64) NOT NULL,
    codegen_version VARCHAR(32) NOT NULL,
    function_names TEXT[] NOT NULL
);

-- Lookup by checksum for change detection
CREATE INDEX IF NOT EXISTS idx_melange_migrations_checksum
ON "public"."melange_migrations" (schema_checksum, codegen_version);


-- ============================================================
-- Check Functions (2 functions)
-- ============================================================

-- Generated check function for sales_rep.finance_viewer
-- Features: Direct
CREATE OR REPLACE FUNCTION "public"."check_sales_rep_finance_viewer"(
    p_subject_type TEXT,
    p_subject_id TEXT,
    p_object_id TEXT,
    p_visited TEXT [] DEFAULT ARRAY[]::TEXT[]
) RETURNS INTEGER AS $$
DECLARE
    v_userset_check INTEGER := 0;
BEGIN
    -- Userset subject handling
    IF position('#' in p_subject_id) > 0 THEN
        -- Case 1: Self-referential userset check
        IF (p_subject_type = 'sales_rep' AND substring(p_subject_id from 1 for position('#' in p_subject_id) - 1) = p_object_id) THEN
        SELECT INTO v_userset_check 1
    FROM (VALUES ('sales_rep', 'can_see_financial_data', 'can_see_financial_data'), ('sales_rep', 'can_see_financial_data', 'finance_viewer'), ('sales_rep', 'finance_viewer', 'finance_viewer')) AS c(object_type, relation, satisfying_relation)
    WHERE (c.object_type = 'sales_rep' AND c.relation = 'finance_viewer' AND c.satisfying_relation = substring(p_subject_id from position('#' in p_subject_id) + 1))
    LIMIT 1;
        IF v_userset_check = 1 THEN
        RETURN 1;
    END IF;
    END IF;
    END IF;
    IF EXISTS (
    SELECT 1
    FROM melange_tuples
    WHERE (object_type = 'sales_rep' AND relation IN ('finance_viewer') AND object_id = p_object_id AND subject_type IN ('user') AND subject_type = p_subject_type AND (subject_id = p_subject_id AND NOT (subject_id = '*')))
    LIMIT 1
    ) THEN
        RETURN 1;
    ELSE
        RETURN 0;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = 'public';


-- Generated check function for sales_rep.can_see_financial_data
-- Features: Implied
CREATE OR REPLACE FUNCTION "public"."check_sales_rep_can_see_financial_data"(
    p_subject_type TEXT,
    p_subject_id TEXT,
    p_object_id TEXT,
    p_visited TEXT [] DEFAULT ARRAY[]::TEXT[]
) RETURNS INTEGER AS $$
DECLARE
    v_userset_check INTEGER := 0;
BEGIN
    -- Userset subject handling
    IF position('#' in p_subject_id) > 0 THEN
        -- Case 1: Self-referential userset check
        IF (p_subject_type = 'sales_rep' AND substring(p_subject_id from 1 for position('#' in p_subject_id) - 1) = p_object_id) THEN
        SELECT INTO v_userset_check 1
    FROM (VALUES ('sales_rep', 'can_see_financial_data', 'can_see_financial_data'), ('sales_rep', 'can_see_financial_data', 'finance_viewer'), ('sales_rep', 'finance_viewer', 'finance_viewer')) AS c(object_type, relation, satisfying_relation)
    WHERE (c.object_type = 'sales_rep' AND c.relation = 'can_see_financial_data' AND c.satisfying_relation = substring(p_subject_id from position('#' in p_subject_id) + 1))
    LIMIT 1;
        IF v_userset_check = 1 THEN
        RETURN 1;
    END IF;
    END IF;
    END IF;
    IF EXISTS (
    SELECT 1
    FROM melange_tuples
    WHERE (object_type = 'sales_rep' AND relation IN ('can_see_financial_data', 'finance_viewer') AND object_id = p_object_id AND subject_type IN ('user') AND subject_type = p_subject_type AND (subject_id = p_subject_id AND NOT (subject_id = '*')))
    LIMIT 1
    ) THEN
        RETURN 1;
    ELSE
        RETURN 0;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = 'public';


-- ============================================================
-- No-Wildcard Check Functions (2 functions)
-- ============================================================

-- Generated check function for sales_rep.finance_viewer
-- Features: Direct
CREATE OR REPLACE FUNCTION "public"."check_sales_rep_finance_viewer_nw"(
    p_subject_type TEXT,
    p_subject_id TEXT,
    p_object_id TEXT,
    p_visited TEXT [] DEFAULT ARRAY[]::TEXT[]
) RETURNS INTEGER AS $$
DECLARE
    v_userset_check INTEGER := 0;
BEGIN
    -- Userset subject handling
    IF position('#' in p_subject_id) > 0 THEN
        -- Case 1: Self-referential userset check
        IF (p_subject_type = 'sales_rep' AND substring(p_subject_id from 1 for position('#' in p_subject_id) - 1) = p_object_id) THEN
        SELECT INTO v_userset_check 1
    FROM (VALUES ('sales_rep', 'can_see_financial_data', 'can_see_financial_data'), ('sales_rep', 'can_see_financial_data', 'finance_viewer'), ('sales_rep', 'finance_viewer', 'finance_viewer')) AS c(object_type, relation, satisfying_relation)
    WHERE (c.object_type = 'sales_rep' AND c.relation = 'finance_viewer' AND c.satisfying_relation = substring(p_subject_id from position('#' in p_subject_id) + 1))
    LIMIT 1;
        IF v_userset_check = 1 THEN
        RETURN 1;
    END IF;
    END IF;
    END IF;
    IF EXISTS (
    SELECT 1
    FROM melange_tuples
    WHERE (object_type = 'sales_rep' AND relation IN ('finance_viewer') AND object_id = p_object_id AND subject_type IN ('user') AND subject_type = p_subject_type AND (subject_id = p_subject_id AND NOT (subject_id = '*')))
    LIMIT 1
    ) THEN
        RETURN 1;
    ELSE
        RETURN 0;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = 'public';


-- Generated check function for sales_rep.can_see_financial_data
-- Features: Implied
CREATE OR REPLACE FUNCTION "public"."check_sales_rep_can_see_financial_data_nw"(
    p_subject_type TEXT,
    p_subject_id TEXT,
    p_object_id TEXT,
    p_visited TEXT [] DEFAULT ARRAY[]::TEXT[]
) RETURNS INTEGER AS $$
DECLARE
    v_userset_check INTEGER := 0;
BEGIN
    -- Userset subject handling
    IF position('#' in p_subject_id) > 0 THEN
        -- Case 1: Self-referential userset check
        IF (p_subject_type = 'sales_rep' AND substring(p_subject_id from 1 for position('#' in p_subject_id) - 1) = p_object_id) THEN
        SELECT INTO v_userset_check 1
    FROM (VALUES ('sales_rep', 'can_see_financial_data', 'can_see_financial_data'), ('sales_rep', 'can_see_financial_data', 'finance_viewer'), ('sales_rep', 'finance_viewer', 'finance_viewer')) AS c(object_type, relation, satisfying_relation)
    WHERE (c.object_type = 'sales_rep' AND c.relation = 'can_see_financial_data' AND c.satisfying_relation = substring(p_subject_id from position('#' in p_subject_id) + 1))
    LIMIT 1;
        IF v_userset_check = 1 THEN
        RETURN 1;
    END IF;
    END IF;
    END IF;
    IF EXISTS (
    SELECT 1
    FROM melange_tuples
    WHERE (object_type = 'sales_rep' AND relation IN ('can_see_financial_data', 'finance_viewer') AND object_id = p_object_id AND subject_type IN ('user') AND subject_type = p_subject_type AND (subject_id = p_subject_id AND NOT (subject_id = '*')))
    LIMIT 1
    ) THEN
        RETURN 1;
    ELSE
        RETURN 0;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = 'public';


-- ============================================================
-- Check Dispatchers
-- ============================================================

-- Generated internal dispatcher for check_permission_internal
-- Routes to specialized functions with p_visited for cycle detection in TTU patterns
-- Enforces depth limit of 25 to prevent stack overflow from deep permission chains
-- Phase 5: All relations use specialized functions - no generic fallback
CREATE OR REPLACE FUNCTION "public"."check_permission_internal"(
    p_subject_type TEXT,
    p_subject_id TEXT,
    p_relation TEXT,
    p_object_type TEXT,
    p_object_id TEXT,
    p_visited TEXT [] DEFAULT ARRAY[]::TEXT[]
) RETURNS INTEGER AS $$
BEGIN
    -- Depth limit check: prevent excessively deep permission resolution chains
    -- This catches both recursive TTU patterns and long userset chains
    IF array_length(p_visited, 1) >= 25 THEN
        RAISE EXCEPTION 'resolution too complex' USING ERRCODE = 'M2002';
    END IF;
    RETURN (SELECT CASE
            WHEN (p_object_type = 'sales_rep' AND p_relation = 'finance_viewer') THEN "public"."check_sales_rep_finance_viewer"(p_subject_type, p_subject_id, p_object_id, p_visited)
            WHEN (p_object_type = 'sales_rep' AND p_relation = 'can_see_financial_data') THEN "public"."check_sales_rep_can_see_financial_data"(p_subject_type, p_subject_id, p_object_id, p_visited)
            ELSE 0
        END);
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = 'public';

-- Generated dispatcher for check_permission
-- Routes to specialized functions for all known type/relation pairs
CREATE OR REPLACE FUNCTION "public"."check_permission"(
    p_subject_type TEXT,
    p_subject_id TEXT,
    p_relation TEXT,
    p_object_type TEXT,
    p_object_id TEXT
) RETURNS INTEGER AS $$
    SELECT "public"."check_permission_internal"(p_subject_type, p_subject_id, p_relation, p_object_type, p_object_id, ARRAY[]::TEXT[]);
$$ LANGUAGE sql STABLE
SET search_path = 'public';


-- Generated internal dispatcher for check_permission_nw_internal
-- Routes to specialized functions with p_visited for cycle detection in TTU patterns
-- Enforces depth limit of 25 to prevent stack overflow from deep permission chains
-- Phase 5: All relations use specialized functions - no generic fallback
CREATE OR REPLACE FUNCTION "public"."check_permission_nw_internal"(
    p_subject_type TEXT,
    p_subject_id TEXT,
    p_relation TEXT,
    p_object_type TEXT,
    p_object_id TEXT,
    p_visited TEXT [] DEFAULT ARRAY[]::TEXT[]
) RETURNS INTEGER AS $$
BEGIN
    -- Depth limit check: prevent excessively deep permission resolution chains
    -- This catches both recursive TTU patterns and long userset chains
    IF array_length(p_visited, 1) >= 25 THEN
        RAISE EXCEPTION 'resolution too complex' USING ERRCODE = 'M2002';
    END IF;
    RETURN (SELECT CASE
            WHEN (p_object_type = 'sales_rep' AND p_relation = 'finance_viewer') THEN "public"."check_sales_rep_finance_viewer_nw"(p_subject_type, p_subject_id, p_object_id, p_visited)
            WHEN (p_object_type = 'sales_rep' AND p_relation = 'can_see_financial_data') THEN "public"."check_sales_rep_can_see_financial_data_nw"(p_subject_type, p_subject_id, p_object_id, p_visited)
            ELSE 0
        END);
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = 'public';

-- Generated dispatcher for check_permission_nw
-- Routes to specialized functions for all known type/relation pairs
CREATE OR REPLACE FUNCTION "public"."check_permission_nw"(
    p_subject_type TEXT,
    p_subject_id TEXT,
    p_relation TEXT,
    p_object_type TEXT,
    p_object_id TEXT
) RETURNS INTEGER AS $$
    SELECT "public"."check_permission_nw_internal"(p_subject_type, p_subject_id, p_relation, p_object_type, p_object_id, ARRAY[]::TEXT[]);
$$ LANGUAGE sql STABLE
SET search_path = 'public';


-- Generated bulk dispatcher for check_permission_bulk
-- Routes 2 (object_type, relation) pairs across 1 object types
-- Uses separate IF blocks to execute only branches for object types present in the batch
CREATE OR REPLACE FUNCTION "public"."check_permission_bulk"(
    p_subject_types TEXT[],
    p_subject_ids TEXT[],
    p_relations TEXT[],
    p_object_types TEXT[],
    p_object_ids TEXT[]
) RETURNS TABLE(idx INTEGER, allowed INTEGER) AS $$
BEGIN
    IF 'sales_rep' = ANY(p_object_types) THEN
        RETURN QUERY
        WITH requests AS MATERIALIZED (
        SELECT t.* FROM UNNEST(p_subject_types, p_subject_ids, p_relations, p_object_types, p_object_ids)
            WITH ORDINALITY AS t(subject_type, subject_id, relation, object_type, object_id, idx)
            WHERE t.object_type = 'sales_rep'
    )
    		SELECT r.idx::INTEGER, CASE
            WHEN (r.subject_type = 'sales_rep' AND position('#' in r.subject_id) > 0 AND split_part(r.subject_id, '#', 1) = r.object_id AND substring(r.subject_id from position('#' in r.subject_id) + 1) IN ('finance_viewer')) THEN 1
            WHEN EXISTS (
    SELECT 1
    FROM melange_tuples AS t
    WHERE (t.subject_type = r.subject_type AND t.subject_id = r.subject_id AND t.relation = 'finance_viewer' AND t.object_type = 'sales_rep' AND t.object_id = r.object_id AND r.subject_type IN ('user'))
    ) THEN 1
            ELSE 0
        END
    		FROM requests AS r
    		WHERE r.relation = 'finance_viewer'
    
    UNION ALL
    
    SELECT r.idx::INTEGER, "public"."check_sales_rep_can_see_financial_data"(r.subject_type, r.subject_id, r.object_id, ARRAY[]::TEXT[])
    FROM requests AS r
    WHERE r.relation = 'can_see_financial_data'
    
    UNION ALL
    
    SELECT r.idx::INTEGER, 0
    FROM requests AS r
    WHERE r.relation NOT IN ('finance_viewer', 'can_see_financial_data');
    END IF;
    RETURN QUERY
        SELECT t.idx::INTEGER, 0
    FROM UNNEST(p_subject_types, p_subject_ids, p_relations, p_object_types, p_object_ids)
      WITH ORDINALITY AS t(subject_type, subject_id, relation, object_type, object_id, idx)
    WHERE (t.object_type, t.relation) NOT IN (('sales_rep', 'finance_viewer'), ('sales_rep', 'can_see_financial_data'));
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = 'public';


-- ============================================================
-- List Objects Functions (2 functions)
-- ============================================================

-- Generated list_objects function for sales_rep.finance_viewer
-- Features: Direct
CREATE OR REPLACE FUNCTION "public"."list_sales_rep_finance_viewer_obj"(
    p_subject_type TEXT,
    p_subject_id TEXT,
    p_limit INT DEFAULT NULL,
    p_after TEXT DEFAULT NULL
) RETURNS TABLE(object_id TEXT, next_cursor TEXT) ROWS 100 AS $$
BEGIN
    RETURN QUERY
        WITH base_results AS (
            -- Direct tuple lookup with simple closure relations
                -- Type guard: only return results if subject type is in allowed subject types
                SELECT DISTINCT t.object_id
                FROM melange_tuples AS t
                WHERE (t.object_type = 'sales_rep' AND t.relation IN ('finance_viewer') AND t.subject_type = p_subject_type AND p_subject_type IN ('user') AND (t.subject_id = p_subject_id AND NOT (t.subject_id = '*')))
                UNION
                -- Self-candidate: subject is userset on same object type
                SELECT split_part(p_subject_id, '#', 1)
                		WHERE (position('#' in p_subject_id) > 0 AND p_subject_type = 'sales_rep' AND EXISTS (
                SELECT 1
                FROM (VALUES ('sales_rep', 'can_see_financial_data', 'can_see_financial_data'), ('sales_rep', 'can_see_financial_data', 'finance_viewer'), ('sales_rep', 'finance_viewer', 'finance_viewer')) AS c(object_type, relation, satisfying_relation)
                WHERE (c.object_type = 'sales_rep' AND c.relation = 'finance_viewer' AND c.satisfying_relation = substring(p_subject_id from position('#' in p_subject_id) + 1))
                ))
        ),
        paged AS (
            SELECT br.object_id
            FROM base_results br
            WHERE (p_after IS NULL OR br.object_id > p_after)
            ORDER BY br.object_id
            LIMIT CASE WHEN p_limit IS NULL THEN NULL ELSE p_limit + 1 END
        ),
        returned AS (
            SELECT p.object_id FROM paged p ORDER BY p.object_id LIMIT p_limit
        ),
        next AS (
            SELECT CASE
                WHEN p_limit IS NOT NULL AND (SELECT count(*) FROM paged) > p_limit
                THEN (SELECT max(r.object_id) FROM returned r)
            END AS next_cursor
        )
        SELECT r.object_id, n.next_cursor
        FROM returned r
        CROSS JOIN next n;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = 'public';

-- Generated list_objects function for sales_rep.can_see_financial_data
-- Features: Implied
CREATE OR REPLACE FUNCTION "public"."list_sales_rep_can_see_financial_data_obj"(
    p_subject_type TEXT,
    p_subject_id TEXT,
    p_limit INT DEFAULT NULL,
    p_after TEXT DEFAULT NULL
) RETURNS TABLE(object_id TEXT, next_cursor TEXT) ROWS 100 AS $$
BEGIN
    RETURN QUERY
        WITH base_results AS (
            -- Direct tuple lookup with simple closure relations
                -- Type guard: only return results if subject type is in allowed subject types
                SELECT DISTINCT t.object_id
                FROM melange_tuples AS t
                WHERE (t.object_type = 'sales_rep' AND t.relation IN ('can_see_financial_data', 'finance_viewer') AND t.subject_type = p_subject_type AND p_subject_type IN ('user') AND (t.subject_id = p_subject_id AND NOT (t.subject_id = '*')))
                UNION
                -- Self-candidate: subject is userset on same object type
                SELECT split_part(p_subject_id, '#', 1)
                		WHERE (position('#' in p_subject_id) > 0 AND p_subject_type = 'sales_rep' AND EXISTS (
                SELECT 1
                FROM (VALUES ('sales_rep', 'can_see_financial_data', 'can_see_financial_data'), ('sales_rep', 'can_see_financial_data', 'finance_viewer'), ('sales_rep', 'finance_viewer', 'finance_viewer')) AS c(object_type, relation, satisfying_relation)
                WHERE (c.object_type = 'sales_rep' AND c.relation = 'can_see_financial_data' AND c.satisfying_relation = substring(p_subject_id from position('#' in p_subject_id) + 1))
                ))
        ),
        paged AS (
            SELECT br.object_id
            FROM base_results br
            WHERE (p_after IS NULL OR br.object_id > p_after)
            ORDER BY br.object_id
            LIMIT CASE WHEN p_limit IS NULL THEN NULL ELSE p_limit + 1 END
        ),
        returned AS (
            SELECT p.object_id FROM paged p ORDER BY p.object_id LIMIT p_limit
        ),
        next AS (
            SELECT CASE
                WHEN p_limit IS NOT NULL AND (SELECT count(*) FROM paged) > p_limit
                THEN (SELECT max(r.object_id) FROM returned r)
            END AS next_cursor
        )
        SELECT r.object_id, n.next_cursor
        FROM returned r
        CROSS JOIN next n;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = 'public';

-- ============================================================
-- List Subjects Functions (2 functions)
-- ============================================================

-- Generated list_subjects function for sales_rep.finance_viewer
-- Features: Direct
CREATE OR REPLACE FUNCTION "public"."list_sales_rep_finance_viewer_sub"(
    p_object_id TEXT,
    p_subject_type TEXT,
    p_limit INT DEFAULT NULL,
    p_after TEXT DEFAULT NULL
) RETURNS TABLE(subject_id TEXT, next_cursor TEXT) ROWS 100 AS $$
DECLARE
    v_filter_type TEXT;
    v_filter_relation TEXT;
BEGIN
    -- Check if subject_type is a userset filter (e.g., "document#viewer")
    IF position('#' in p_subject_type) > 0 THEN
        v_filter_type := substring(p_subject_type from 1 for position('#' in p_subject_type) - 1);
        v_filter_relation := substring(p_subject_type from position('#' in p_subject_type) + 1);
        RETURN QUERY
        WITH base_results AS (
            -- Userset filter: find userset tuples that match and return normalized references
                SELECT DISTINCT split_part(t.subject_id, '#', 1) || '#' || v_filter_relation AS subject_id
                		FROM melange_tuples AS t
                		WHERE (t.object_type = 'sales_rep' AND t.relation IN ('finance_viewer') AND t.object_id = p_object_id AND t.subject_type = v_filter_type AND position('#' in t.subject_id) > 0 AND (substring(t.subject_id from position('#' in t.subject_id) + 1) = v_filter_relation OR EXISTS (
                SELECT 1
                FROM (VALUES ('sales_rep', 'can_see_financial_data', 'can_see_financial_data'), ('sales_rep', 'can_see_financial_data', 'finance_viewer'), ('sales_rep', 'finance_viewer', 'finance_viewer')) AS subj_c(object_type, relation, satisfying_relation)
                WHERE (subj_c.object_type = v_filter_type AND subj_c.relation = substring(t.subject_id from position('#' in t.subject_id) + 1) AND subj_c.satisfying_relation = v_filter_relation)
                )) AND "public"."check_permission"(v_filter_type, t.subject_id, 'finance_viewer', 'sales_rep', p_object_id) = 1)
                UNION
                -- Self-candidate: when filter type matches object type
                -- e.g., querying document:1.viewer with filter document#writer
                -- should return document:1#writer if writer satisfies the relation
                SELECT p_object_id || '#' || v_filter_relation AS subject_id
                		WHERE (v_filter_type = 'sales_rep' AND EXISTS (
                SELECT 1
                FROM (VALUES ('sales_rep', 'can_see_financial_data', 'can_see_financial_data'), ('sales_rep', 'can_see_financial_data', 'finance_viewer'), ('sales_rep', 'finance_viewer', 'finance_viewer')) AS c(object_type, relation, satisfying_relation)
                WHERE (c.object_type = 'sales_rep' AND c.relation = 'finance_viewer' AND c.satisfying_relation = v_filter_relation)
                ))
        ),
        paged AS (
            SELECT br.subject_id
            FROM base_results br
            WHERE p_after IS NULL OR (
                -- Compound comparison for wildcard-first ordering:
                -- (is_not_wildcard, subject_id) > (cursor_is_not_wildcard, cursor)
                (CASE WHEN br.subject_id = '*' THEN 0 ELSE 1 END, br.subject_id) >
                (CASE WHEN p_after = '*' THEN 0 ELSE 1 END, p_after)
            )
            ORDER BY (CASE WHEN br.subject_id = '*' THEN 0 ELSE 1 END), br.subject_id
            LIMIT CASE WHEN p_limit IS NULL THEN NULL ELSE p_limit + 1 END
        ),
        returned AS (
            SELECT p.subject_id FROM paged p
            ORDER BY (CASE WHEN p.subject_id = '*' THEN 0 ELSE 1 END), p.subject_id
            LIMIT p_limit
        ),
        next AS (
            SELECT CASE
                WHEN p_limit IS NOT NULL AND (SELECT count(*) FROM paged) > p_limit
                THEN (SELECT r.subject_id FROM returned r
                      ORDER BY (CASE WHEN r.subject_id = '*' THEN 0 ELSE 1 END) DESC, r.subject_id DESC
                      LIMIT 1)
            END AS next_cursor
        )
        SELECT r.subject_id, n.next_cursor
        FROM returned r
        CROSS JOIN next n;
    ELSE
        -- Guard: return empty if subject type is not allowed by the model
        IF p_subject_type NOT IN ('user') THEN
        RETURN;
    END IF;
        -- Regular subject type (no userset filter)
        RETURN QUERY
        WITH base_results AS (
            -- Path 1: Direct tuple lookup with simple closure relations
                SELECT DISTINCT t.subject_id
                FROM melange_tuples AS t
                WHERE (t.object_type = 'sales_rep' AND t.relation IN ('finance_viewer') AND t.object_id = p_object_id AND t.subject_type = p_subject_type AND position('#' in t.subject_id) = 0 AND t.subject_id <> '*')
        ),
        paged AS (
            SELECT br.subject_id
            FROM base_results br
            WHERE p_after IS NULL OR (
                -- Compound comparison for wildcard-first ordering:
                -- (is_not_wildcard, subject_id) > (cursor_is_not_wildcard, cursor)
                (CASE WHEN br.subject_id = '*' THEN 0 ELSE 1 END, br.subject_id) >
                (CASE WHEN p_after = '*' THEN 0 ELSE 1 END, p_after)
            )
            ORDER BY (CASE WHEN br.subject_id = '*' THEN 0 ELSE 1 END), br.subject_id
            LIMIT CASE WHEN p_limit IS NULL THEN NULL ELSE p_limit + 1 END
        ),
        returned AS (
            SELECT p.subject_id FROM paged p
            ORDER BY (CASE WHEN p.subject_id = '*' THEN 0 ELSE 1 END), p.subject_id
            LIMIT p_limit
        ),
        next AS (
            SELECT CASE
                WHEN p_limit IS NOT NULL AND (SELECT count(*) FROM paged) > p_limit
                THEN (SELECT r.subject_id FROM returned r
                      ORDER BY (CASE WHEN r.subject_id = '*' THEN 0 ELSE 1 END) DESC, r.subject_id DESC
                      LIMIT 1)
            END AS next_cursor
        )
        SELECT r.subject_id, n.next_cursor
        FROM returned r
        CROSS JOIN next n;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = 'public';

-- Generated list_subjects function for sales_rep.can_see_financial_data
-- Features: Implied
CREATE OR REPLACE FUNCTION "public"."list_sales_rep_can_see_financial_data_sub"(
    p_object_id TEXT,
    p_subject_type TEXT,
    p_limit INT DEFAULT NULL,
    p_after TEXT DEFAULT NULL
) RETURNS TABLE(subject_id TEXT, next_cursor TEXT) ROWS 100 AS $$
DECLARE
    v_filter_type TEXT;
    v_filter_relation TEXT;
BEGIN
    -- Check if subject_type is a userset filter (e.g., "document#viewer")
    IF position('#' in p_subject_type) > 0 THEN
        v_filter_type := substring(p_subject_type from 1 for position('#' in p_subject_type) - 1);
        v_filter_relation := substring(p_subject_type from position('#' in p_subject_type) + 1);
        RETURN QUERY
        WITH base_results AS (
            -- Userset filter: find userset tuples that match and return normalized references
                SELECT DISTINCT split_part(t.subject_id, '#', 1) || '#' || v_filter_relation AS subject_id
                		FROM melange_tuples AS t
                		WHERE (t.object_type = 'sales_rep' AND t.relation IN ('can_see_financial_data', 'finance_viewer') AND t.object_id = p_object_id AND t.subject_type = v_filter_type AND position('#' in t.subject_id) > 0 AND (substring(t.subject_id from position('#' in t.subject_id) + 1) = v_filter_relation OR EXISTS (
                SELECT 1
                FROM (VALUES ('sales_rep', 'can_see_financial_data', 'can_see_financial_data'), ('sales_rep', 'can_see_financial_data', 'finance_viewer'), ('sales_rep', 'finance_viewer', 'finance_viewer')) AS subj_c(object_type, relation, satisfying_relation)
                WHERE (subj_c.object_type = v_filter_type AND subj_c.relation = substring(t.subject_id from position('#' in t.subject_id) + 1) AND subj_c.satisfying_relation = v_filter_relation)
                )) AND "public"."check_permission"(v_filter_type, t.subject_id, 'can_see_financial_data', 'sales_rep', p_object_id) = 1)
                UNION
                -- Self-candidate: when filter type matches object type
                -- e.g., querying document:1.viewer with filter document#writer
                -- should return document:1#writer if writer satisfies the relation
                SELECT p_object_id || '#' || v_filter_relation AS subject_id
                		WHERE (v_filter_type = 'sales_rep' AND EXISTS (
                SELECT 1
                FROM (VALUES ('sales_rep', 'can_see_financial_data', 'can_see_financial_data'), ('sales_rep', 'can_see_financial_data', 'finance_viewer'), ('sales_rep', 'finance_viewer', 'finance_viewer')) AS c(object_type, relation, satisfying_relation)
                WHERE (c.object_type = 'sales_rep' AND c.relation = 'can_see_financial_data' AND c.satisfying_relation = v_filter_relation)
                ))
        ),
        paged AS (
            SELECT br.subject_id
            FROM base_results br
            WHERE p_after IS NULL OR (
                -- Compound comparison for wildcard-first ordering:
                -- (is_not_wildcard, subject_id) > (cursor_is_not_wildcard, cursor)
                (CASE WHEN br.subject_id = '*' THEN 0 ELSE 1 END, br.subject_id) >
                (CASE WHEN p_after = '*' THEN 0 ELSE 1 END, p_after)
            )
            ORDER BY (CASE WHEN br.subject_id = '*' THEN 0 ELSE 1 END), br.subject_id
            LIMIT CASE WHEN p_limit IS NULL THEN NULL ELSE p_limit + 1 END
        ),
        returned AS (
            SELECT p.subject_id FROM paged p
            ORDER BY (CASE WHEN p.subject_id = '*' THEN 0 ELSE 1 END), p.subject_id
            LIMIT p_limit
        ),
        next AS (
            SELECT CASE
                WHEN p_limit IS NOT NULL AND (SELECT count(*) FROM paged) > p_limit
                THEN (SELECT r.subject_id FROM returned r
                      ORDER BY (CASE WHEN r.subject_id = '*' THEN 0 ELSE 1 END) DESC, r.subject_id DESC
                      LIMIT 1)
            END AS next_cursor
        )
        SELECT r.subject_id, n.next_cursor
        FROM returned r
        CROSS JOIN next n;
    ELSE
        -- Guard: return empty if subject type is not allowed by the model
        IF p_subject_type NOT IN ('user') THEN
        RETURN;
    END IF;
        -- Regular subject type (no userset filter)
        RETURN QUERY
        WITH base_results AS (
            -- Path 1: Direct tuple lookup with simple closure relations
                SELECT DISTINCT t.subject_id
                FROM melange_tuples AS t
                WHERE (t.object_type = 'sales_rep' AND t.relation IN ('can_see_financial_data', 'finance_viewer') AND t.object_id = p_object_id AND t.subject_type = p_subject_type AND position('#' in t.subject_id) = 0 AND t.subject_id <> '*')
        ),
        paged AS (
            SELECT br.subject_id
            FROM base_results br
            WHERE p_after IS NULL OR (
                -- Compound comparison for wildcard-first ordering:
                -- (is_not_wildcard, subject_id) > (cursor_is_not_wildcard, cursor)
                (CASE WHEN br.subject_id = '*' THEN 0 ELSE 1 END, br.subject_id) >
                (CASE WHEN p_after = '*' THEN 0 ELSE 1 END, p_after)
            )
            ORDER BY (CASE WHEN br.subject_id = '*' THEN 0 ELSE 1 END), br.subject_id
            LIMIT CASE WHEN p_limit IS NULL THEN NULL ELSE p_limit + 1 END
        ),
        returned AS (
            SELECT p.subject_id FROM paged p
            ORDER BY (CASE WHEN p.subject_id = '*' THEN 0 ELSE 1 END), p.subject_id
            LIMIT p_limit
        ),
        next AS (
            SELECT CASE
                WHEN p_limit IS NOT NULL AND (SELECT count(*) FROM paged) > p_limit
                THEN (SELECT r.subject_id FROM returned r
                      ORDER BY (CASE WHEN r.subject_id = '*' THEN 0 ELSE 1 END) DESC, r.subject_id DESC
                      LIMIT 1)
            END AS next_cursor
        )
        SELECT r.subject_id, n.next_cursor
        FROM returned r
        CROSS JOIN next n;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = 'public';

-- ============================================================
-- List Dispatchers
-- ============================================================

-- Generated dispatcher for list_accessible_objects
-- Routes to specialized functions for all type/relation pairs
CREATE OR REPLACE FUNCTION "public"."list_accessible_objects"(
    p_subject_type TEXT,
    p_subject_id TEXT,
    p_relation TEXT,
    p_object_type TEXT,
    p_limit INT DEFAULT NULL,
    p_after TEXT DEFAULT NULL
) RETURNS TABLE (object_id TEXT, next_cursor TEXT) ROWS 100 AS $$
BEGIN
    -- Route to specialized functions for all type/relation pairs
    IF (p_object_type = 'sales_rep' AND p_relation = 'finance_viewer') THEN
        RETURN QUERY
        SELECT * FROM "public"."list_sales_rep_finance_viewer_obj"(p_subject_type, p_subject_id, p_limit, p_after);
        RETURN;
    END IF;
    IF (p_object_type = 'sales_rep' AND p_relation = 'can_see_financial_data') THEN
        RETURN QUERY
        SELECT * FROM "public"."list_sales_rep_can_see_financial_data_obj"(p_subject_type, p_subject_id, p_limit, p_after);
        RETURN;
    END IF;
    -- Unknown type/relation pair - return empty result (relation not defined in model)
    -- This matches check_permission behavior for unknown relations (returns 0/denied)
    RETURN;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = 'public';

-- Generated dispatcher for list_accessible_subjects
-- Routes to specialized functions for all type/relation pairs
CREATE OR REPLACE FUNCTION "public"."list_accessible_subjects"(
    p_object_type TEXT,
    p_object_id TEXT,
    p_relation TEXT,
    p_subject_type TEXT,
    p_limit INT DEFAULT NULL,
    p_after TEXT DEFAULT NULL
) RETURNS TABLE (subject_id TEXT, next_cursor TEXT) ROWS 100 AS $$
BEGIN
    -- Route to specialized functions for all type/relation pairs
    IF (p_object_type = 'sales_rep' AND p_relation = 'finance_viewer') THEN
        RETURN QUERY
        SELECT * FROM "public"."list_sales_rep_finance_viewer_sub"(p_object_id, p_subject_type, p_limit, p_after);
        RETURN;
    END IF;
    IF (p_object_type = 'sales_rep' AND p_relation = 'can_see_financial_data') THEN
        RETURN QUERY
        SELECT * FROM "public"."list_sales_rep_can_see_financial_data_sub"(p_object_id, p_subject_type, p_limit, p_after);
        RETURN;
    END IF;
    -- Unknown type/relation pair - return empty result (relation not defined in model)
    -- This matches check_permission behavior for unknown relations (returns 0/denied)
    RETURN;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = 'public';

-- ============================================================
-- Migration Record
-- ============================================================

INSERT INTO "public"."melange_migrations" (melange_version, schema_checksum, codegen_version, function_names)
VALUES ('0.8.1', 'e662fa93e8e5a7951b8760f6bd0ee08be19f23af6816c506756ba65980ed80c6', '0.8.1', ARRAY['check_permission', 'check_permission_bulk', 'check_permission_internal', 'check_permission_nw', 'check_permission_nw_internal', 'check_sales_rep_can_see_financial_data', 'check_sales_rep_can_see_financial_data_nw', 'check_sales_rep_finance_viewer', 'check_sales_rep_finance_viewer_nw', 'list_accessible_objects', 'list_accessible_subjects', 'list_sales_rep_can_see_financial_data_obj', 'list_sales_rep_can_see_financial_data_sub', 'list_sales_rep_finance_viewer_obj', 'list_sales_rep_finance_viewer_sub']);
