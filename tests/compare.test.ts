import { describe, expect, it } from 'bun:test'

import { compareSchemas, normalizeDefault, normalizeIndexDefinition } from '../src/compare.js'
import type { SchemaSnapshot } from '../src/types.js'

function emptySnapshot(overrides: Partial<SchemaSnapshot> = {}): SchemaSnapshot {
    return {
        tables: [],
        columns: [],
        indexes: [],
        foreignKeys: [],
        checkConstraints: [],
        uniqueConstraints: [],
        enumTypes: [],
        extensions: [],
        ...overrides,
    }
}

describe('normalizeDefault', () => {
    it('returns null for null', () => {
        expect(normalizeDefault(null)).toBeNull()
    })

    it('normalizes nextval sequences', () => {
        expect(normalizeDefault("nextval('users_id_seq'::regclass)")).toBe('nextval(autoincrement)')
        expect(normalizeDefault("nextval('public.users_id_seq'::regclass)")).toBe(
            'nextval(autoincrement)',
        )
    })

    it('normalizes quoted type casts', () => {
        expect(normalizeDefault("'0'::bigint")).toBe('0')
        expect(normalizeDefault("'active'::character varying")).toBe('active')
        expect(normalizeDefault("'hello'::text")).toBe('hello')
    })

    it('normalizes numeric type casts', () => {
        expect(normalizeDefault('0::bigint')).toBe('0')
        expect(normalizeDefault('100::integer')).toBe('100')
        expect(normalizeDefault('-1::smallint')).toBe('-1')
        expect(normalizeDefault('3.14::double precision')).toBe('3.14')
    })

    it('normalizes NULL::type casts', () => {
        expect(normalizeDefault('NULL::character varying')).toBe('NULL')
        expect(normalizeDefault('NULL::timestamp without time zone')).toBe('NULL')
    })

    it('returns plain values unchanged', () => {
        expect(normalizeDefault('true')).toBe('true')
        expect(normalizeDefault('false')).toBe('false')
        expect(normalizeDefault('42')).toBe('42')
    })
})

describe('normalizeIndexDefinition', () => {
    it('removes index name from standard index', () => {
        expect(
            normalizeIndexDefinition(
                'CREATE INDEX idx_users_email ON public.users USING btree (email)',
            ),
        ).toBe('CREATE INDEX ON public.users USING btree (email)')
    })

    it('removes index name from unique index', () => {
        expect(
            normalizeIndexDefinition(
                'CREATE UNIQUE INDEX users_email_unique ON public.users USING btree (email)',
            ),
        ).toBe('CREATE UNIQUE INDEX ON public.users USING btree (email)')
    })

    it('produces same result for different index names on same definition', () => {
        const a = normalizeIndexDefinition('CREATE INDEX idx_a ON public.users USING btree (email)')
        const b = normalizeIndexDefinition('CREATE INDEX idx_b ON public.users USING btree (email)')
        expect(a).toBe(b)
    })
})

describe('compareTables', () => {
    it('returns no diffs for identical tables', () => {
        const source = emptySnapshot({ tables: [{ table_name: 'users' }, { table_name: 'posts' }] })
        const target = emptySnapshot({ tables: [{ table_name: 'users' }, { table_name: 'posts' }] })
        const diff = compareSchemas(source, target)
        expect(diff.tables).toHaveLength(0)
    })

    it('detects table missing in target', () => {
        const source = emptySnapshot({ tables: [{ table_name: 'users' }, { table_name: 'posts' }] })
        const target = emptySnapshot({ tables: [{ table_name: 'users' }] })
        const diff = compareSchemas(source, target)
        expect(diff.tables).toHaveLength(1)
        expect(diff.tables[0].table).toBe('posts')
        expect(diff.tables[0].type).toBe('missing_in_target')
    })

    it('detects table missing in source', () => {
        const source = emptySnapshot({ tables: [{ table_name: 'users' }] })
        const target = emptySnapshot({ tables: [{ table_name: 'users' }, { table_name: 'posts' }] })
        const diff = compareSchemas(source, target)
        expect(diff.tables).toHaveLength(1)
        expect(diff.tables[0].table).toBe('posts')
        expect(diff.tables[0].type).toBe('missing_in_source')
    })

    it('skips column diffs for missing tables', () => {
        const source = emptySnapshot({
            tables: [{ table_name: 'users' }, { table_name: 'posts' }],
            columns: [
                {
                    table_name: 'users',
                    column_name: 'id',
                    data_type: 'bigint',
                    is_nullable: 'NO',
                    column_default: null,
                },
                {
                    table_name: 'posts',
                    column_name: 'id',
                    data_type: 'bigint',
                    is_nullable: 'NO',
                    column_default: null,
                },
            ],
        })
        const target = emptySnapshot({
            tables: [{ table_name: 'users' }],
            columns: [
                {
                    table_name: 'users',
                    column_name: 'id',
                    data_type: 'bigint',
                    is_nullable: 'NO',
                    column_default: null,
                },
            ],
        })
        const diff = compareSchemas(source, target)
        expect(diff.tables).toHaveLength(1)
        expect(diff.columns).toHaveLength(0)
    })
})

describe('compareCheckConstraints', () => {
    it('returns no diffs for identical check constraints', () => {
        const cc = {
            table_name: 'users',
            constraint_name: 'chk_age',
            check_definition: 'CHECK ((age > 0))',
        }
        const source = emptySnapshot({ checkConstraints: [cc] })
        const target = emptySnapshot({
            checkConstraints: [{ ...cc, constraint_name: 'chk_age_v2' }],
        })
        const diff = compareSchemas(source, target)
        expect(diff.checkConstraints).toHaveLength(0)
    })

    it('detects check constraint missing in target', () => {
        const source = emptySnapshot({
            checkConstraints: [
                {
                    table_name: 'users',
                    constraint_name: 'chk_age',
                    check_definition: 'CHECK ((age > 0))',
                },
            ],
        })
        const target = emptySnapshot()
        const diff = compareSchemas(source, target)
        expect(diff.checkConstraints).toHaveLength(1)
        expect(diff.checkConstraints[0].type).toBe('missing_in_target')
        expect(diff.checkConstraints[0].table).toBe('users')
    })

    it('detects check constraint missing in source', () => {
        const source = emptySnapshot()
        const target = emptySnapshot({
            checkConstraints: [
                {
                    table_name: 'orders',
                    constraint_name: 'chk_total',
                    check_definition: 'CHECK ((total >= 0))',
                },
            ],
        })
        const diff = compareSchemas(source, target)
        expect(diff.checkConstraints).toHaveLength(1)
        expect(diff.checkConstraints[0].type).toBe('missing_in_source')
        expect(diff.checkConstraints[0].table).toBe('orders')
    })
})

describe('compareUniqueConstraints', () => {
    it('returns no diffs for identical unique constraints', () => {
        const uc = {
            table_name: 'users',
            constraint_name: 'uq_email',
            unique_definition: 'UNIQUE (email)',
        }
        const source = emptySnapshot({ uniqueConstraints: [uc] })
        const target = emptySnapshot({
            uniqueConstraints: [{ ...uc, constraint_name: 'users_email_unique' }],
        })
        const diff = compareSchemas(source, target)
        expect(diff.uniqueConstraints).toHaveLength(0)
    })

    it('detects unique constraint missing in target', () => {
        const source = emptySnapshot({
            uniqueConstraints: [
                {
                    table_name: 'users',
                    constraint_name: 'uq_email',
                    unique_definition: 'UNIQUE (email)',
                },
            ],
        })
        const target = emptySnapshot()
        const diff = compareSchemas(source, target)
        expect(diff.uniqueConstraints).toHaveLength(1)
        expect(diff.uniqueConstraints[0].type).toBe('missing_in_target')
    })

    it('detects unique constraint missing in source', () => {
        const source = emptySnapshot()
        const target = emptySnapshot({
            uniqueConstraints: [
                {
                    table_name: 'users',
                    constraint_name: 'uq_email',
                    unique_definition: 'UNIQUE (email)',
                },
            ],
        })
        const diff = compareSchemas(source, target)
        expect(diff.uniqueConstraints).toHaveLength(1)
        expect(diff.uniqueConstraints[0].type).toBe('missing_in_source')
    })
})

describe('compareEnumTypes', () => {
    it('returns no diffs for identical enums', () => {
        const e = { enum_name: 'status', enum_values: 'active, inactive' }
        const source = emptySnapshot({ enumTypes: [e] })
        const target = emptySnapshot({ enumTypes: [e] })
        const diff = compareSchemas(source, target)
        expect(diff.enumTypes).toHaveLength(0)
    })

    it('detects enum missing in target', () => {
        const source = emptySnapshot({
            enumTypes: [{ enum_name: 'status', enum_values: 'active, inactive' }],
        })
        const target = emptySnapshot()
        const diff = compareSchemas(source, target)
        expect(diff.enumTypes).toHaveLength(1)
        expect(diff.enumTypes[0].type).toBe('missing_in_target')
        expect(diff.enumTypes[0].name).toBe('status')
    })

    it('detects enum missing in source', () => {
        const source = emptySnapshot()
        const target = emptySnapshot({
            enumTypes: [{ enum_name: 'role', enum_values: 'admin, user' }],
        })
        const diff = compareSchemas(source, target)
        expect(diff.enumTypes).toHaveLength(1)
        expect(diff.enumTypes[0].type).toBe('missing_in_source')
    })

    it('detects enum value mismatch', () => {
        const source = emptySnapshot({
            enumTypes: [{ enum_name: 'status', enum_values: 'active, inactive' }],
        })
        const target = emptySnapshot({
            enumTypes: [{ enum_name: 'status', enum_values: 'active, inactive, archived' }],
        })
        const diff = compareSchemas(source, target)
        expect(diff.enumTypes).toHaveLength(1)
        expect(diff.enumTypes[0].type).toBe('mismatch')
        expect(diff.enumTypes[0].sourceValues).toBe('active, inactive')
        expect(diff.enumTypes[0].targetValues).toBe('active, inactive, archived')
    })
})

describe('compareExtensions', () => {
    it('returns no diffs for identical extensions', () => {
        const ext = { extension_name: 'pg_trgm', extension_version: '1.6' }
        const source = emptySnapshot({ extensions: [ext] })
        const target = emptySnapshot({ extensions: [ext] })
        const diff = compareSchemas(source, target)
        expect(diff.extensions).toHaveLength(0)
    })

    it('detects extension missing in target', () => {
        const source = emptySnapshot({
            extensions: [{ extension_name: 'pg_trgm', extension_version: '1.6' }],
        })
        const target = emptySnapshot()
        const diff = compareSchemas(source, target)
        expect(diff.extensions).toHaveLength(1)
        expect(diff.extensions[0].type).toBe('missing_in_target')
        expect(diff.extensions[0].name).toBe('pg_trgm')
    })

    it('detects extension missing in source', () => {
        const source = emptySnapshot()
        const target = emptySnapshot({
            extensions: [{ extension_name: 'uuid-ossp', extension_version: '1.1' }],
        })
        const diff = compareSchemas(source, target)
        expect(diff.extensions).toHaveLength(1)
        expect(diff.extensions[0].type).toBe('missing_in_source')
    })

    it('detects extension version mismatch', () => {
        const source = emptySnapshot({
            extensions: [{ extension_name: 'pg_trgm', extension_version: '1.5' }],
        })
        const target = emptySnapshot({
            extensions: [{ extension_name: 'pg_trgm', extension_version: '1.6' }],
        })
        const diff = compareSchemas(source, target)
        expect(diff.extensions).toHaveLength(1)
        expect(diff.extensions[0].type).toBe('mismatch')
        expect(diff.extensions[0].sourceVersion).toBe('1.5')
        expect(diff.extensions[0].targetVersion).toBe('1.6')
    })
})
