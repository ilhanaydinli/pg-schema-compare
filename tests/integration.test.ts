import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import pg from 'pg'

import { compareSchemas } from '../src/compare.js'
import { fetchSchema } from '../src/queries.js'

const { Client } = pg

const PG_URL = process.env.PG_URL ?? 'postgres://localhost:5432/postgres'
const DB_SOURCE = 'pgsc_test_source'
const DB_TARGET = 'pgsc_test_target'

function connStr(db: string): string {
    const url = new URL(PG_URL)
    url.pathname = `/${db}`
    return url.toString()
}

async function execOnAdmin(sql: string): Promise<void> {
    const client = new Client({ connectionString: PG_URL })
    await client.connect()
    try {
        await client.query(sql)
    } finally {
        await client.end()
    }
}

async function execOn(db: string, sql: string): Promise<void> {
    const client = new Client({ connectionString: connStr(db) })
    await client.connect()
    try {
        await client.query(sql)
    } finally {
        await client.end()
    }
}

const SHARED_SCHEMA = `
    CREATE TABLE users (
        id BIGSERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        name TEXT,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_users_email ON users (email);

    CREATE TABLE posts (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id),
        title VARCHAR(255) NOT NULL,
        body TEXT,
        published BOOLEAN NOT NULL DEFAULT false
    );
    CREATE INDEX idx_posts_user_id ON posts (user_id);

    CREATE TABLE migrations (
        id SERIAL PRIMARY KEY,
        migration VARCHAR(255) NOT NULL,
        batch INTEGER NOT NULL
    );
`

beforeAll(async () => {
    await execOnAdmin(`DROP DATABASE IF EXISTS ${DB_SOURCE}`)
    await execOnAdmin(`DROP DATABASE IF EXISTS ${DB_TARGET}`)
    await execOnAdmin(`CREATE DATABASE ${DB_SOURCE}`)
    await execOnAdmin(`CREATE DATABASE ${DB_TARGET}`)

    // Source: shared schema
    await execOn(DB_SOURCE, SHARED_SCHEMA)

    // Target: shared schema (identical)
    await execOn(DB_TARGET, SHARED_SCHEMA)
})

afterAll(async () => {
    await execOnAdmin(`DROP DATABASE IF EXISTS ${DB_SOURCE}`)
    await execOnAdmin(`DROP DATABASE IF EXISTS ${DB_TARGET}`)
})

describe('integration', () => {
    it('returns no diffs for identical schemas', async () => {
        const source = await fetchSchema(connStr(DB_SOURCE))
        const target = await fetchSchema(connStr(DB_TARGET))
        const diff = compareSchemas(source, target)

        expect(diff.tables).toHaveLength(0)
        expect(diff.columns).toHaveLength(0)
        expect(diff.indexes).toHaveLength(0)
        expect(diff.foreignKeys).toHaveLength(0)
        expect(diff.checkConstraints).toHaveLength(0)
        expect(diff.uniqueConstraints).toHaveLength(0)
        expect(diff.enumTypes).toHaveLength(0)
        expect(diff.extensions).toHaveLength(0)
    })

    it('includes all tables when no exclude is specified', async () => {
        const schema = await fetchSchema(connStr(DB_SOURCE))
        const migrationColumns = schema.columns.filter((c) => c.table_name === 'migrations')

        expect(migrationColumns.length).toBeGreaterThan(0)
    })

    it('fetches columns with correct types', async () => {
        const schema = await fetchSchema(connStr(DB_SOURCE))

        const emailCol = schema.columns.find(
            (c) => c.table_name === 'users' && c.column_name === 'email',
        )
        expect(emailCol).toBeDefined()
        expect(emailCol!.data_type).toBe('character varying')
        expect(emailCol!.is_nullable).toBe('NO')

        const nameCol = schema.columns.find(
            (c) => c.table_name === 'users' && c.column_name === 'name',
        )
        expect(nameCol).toBeDefined()
        expect(nameCol!.data_type).toBe('text')
        expect(nameCol!.is_nullable).toBe('YES')
    })

    it('fetches indexes (excluding primary keys)', async () => {
        const schema = await fetchSchema(connStr(DB_SOURCE))

        const hasEmailIdx = schema.indexes.some(
            (i) => i.table_name === 'users' && i.index_definition.includes('email'),
        )
        expect(hasEmailIdx).toBe(true)

        // Primary key indexes should not be included
        const hasPkIdx = schema.indexes.some((i) => i.index_name === 'users_pkey')
        expect(hasPkIdx).toBe(false)
    })

    it('fetches foreign keys', async () => {
        const schema = await fetchSchema(connStr(DB_SOURCE))

        const fk = schema.foreignKeys.find((f) => f.table_name === 'posts')
        expect(fk).toBeDefined()
        expect(fk!.fk_definition).toContain('user_id')
        expect(fk!.fk_definition).toContain('users')
    })

    it('detects missing table in target', async () => {
        await execOn(
            DB_SOURCE,
            `
            CREATE TABLE comments (
                id BIGSERIAL PRIMARY KEY,
                body TEXT NOT NULL
            )
        `,
        )

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            const missing = diff.tables.find(
                (t) => t.table === 'comments' && t.type === 'missing_in_target',
            )
            expect(missing).toBeDefined()

            // Column diffs should NOT include columns from missing table
            const commentCols = diff.columns.filter((c) => c.table === 'comments')
            expect(commentCols).toHaveLength(0)
        } finally {
            await execOn(DB_SOURCE, 'DROP TABLE comments')
        }
    })

    it('detects missing table in source', async () => {
        await execOn(
            DB_TARGET,
            `
            CREATE TABLE tags (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL
            )
        `,
        )

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            const missing = diff.tables.find(
                (t) => t.table === 'tags' && t.type === 'missing_in_source',
            )
            expect(missing).toBeDefined()
        } finally {
            await execOn(DB_TARGET, 'DROP TABLE tags')
        }
    })

    it('detects missing column in target', async () => {
        await execOn(DB_SOURCE, 'ALTER TABLE users ADD COLUMN legacy_field TEXT')

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            const missing = diff.columns.find(
                (c) => c.column === 'legacy_field' && c.type === 'missing_in_target',
            )
            expect(missing).toBeDefined()
            expect(missing!.table).toBe('users')
        } finally {
            await execOn(DB_SOURCE, 'ALTER TABLE users DROP COLUMN legacy_field')
        }
    })

    it('detects missing column in source', async () => {
        await execOn(DB_TARGET, 'ALTER TABLE users ADD COLUMN new_field TEXT')

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            const missing = diff.columns.find(
                (c) => c.column === 'new_field' && c.type === 'missing_in_source',
            )
            expect(missing).toBeDefined()
            expect(missing!.table).toBe('users')
        } finally {
            await execOn(DB_TARGET, 'ALTER TABLE users DROP COLUMN new_field')
        }
    })

    it('detects column type mismatch', async () => {
        await execOn(DB_TARGET, 'ALTER TABLE users ALTER COLUMN name TYPE VARCHAR(500)')

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            const mismatch = diff.columns.find((c) => c.column === 'name' && c.type === 'mismatch')
            expect(mismatch).toBeDefined()
            expect(mismatch!.source!.data_type).toBe('text')
            expect(mismatch!.target!.data_type).toBe('character varying')
        } finally {
            await execOn(DB_TARGET, 'ALTER TABLE users ALTER COLUMN name TYPE TEXT')
        }
    })

    it('detects missing index in target', async () => {
        await execOn(DB_SOURCE, 'CREATE INDEX idx_users_name ON users (name)')

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            const missing = diff.indexes.find(
                (i) => i.type === 'missing_in_target' && i.definition.includes('name'),
            )
            expect(missing).toBeDefined()
            expect(missing!.table).toBe('users')
        } finally {
            await execOn(DB_SOURCE, 'DROP INDEX idx_users_name')
        }
    })

    it('detects missing FK in target', async () => {
        await execOn(
            DB_SOURCE,
            `
            CREATE TABLE comments (
                id BIGSERIAL PRIMARY KEY,
                post_id BIGINT NOT NULL REFERENCES posts(id)
            )
        `,
        )

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            const missingFk = diff.foreignKeys.find(
                (f) => f.table === 'comments' && f.type === 'missing_in_target',
            )
            expect(missingFk).toBeDefined()
        } finally {
            await execOn(DB_SOURCE, 'DROP TABLE comments')
        }
    })

    it('excludes custom tables via excludeTables param', async () => {
        const schema = await fetchSchema(connStr(DB_SOURCE), ['posts'])
        const postColumns = schema.columns.filter((c) => c.table_name === 'posts')

        expect(postColumns).toHaveLength(0)
    })

    it('ignores index name differences between databases', async () => {
        // Drop and recreate index with different name on target
        await execOn(DB_TARGET, 'DROP INDEX idx_posts_user_id')
        await execOn(DB_TARGET, 'CREATE INDEX idx_posts_user_id_v2 ON posts (user_id)')

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            // Should have no index diffs - same definition, different name
            const postIndexDiffs = diff.indexes.filter((i) => i.table === 'posts')
            expect(postIndexDiffs).toHaveLength(0)
        } finally {
            await execOn(DB_TARGET, 'DROP INDEX idx_posts_user_id_v2')
            await execOn(DB_TARGET, 'CREATE INDEX idx_posts_user_id ON posts (user_id)')
        }
    })

    it('detects missing check constraint in target', async () => {
        await execOn(
            DB_SOURCE,
            `ALTER TABLE posts ADD CONSTRAINT chk_title_len CHECK (length(title) > 0)`,
        )

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            const missing = diff.checkConstraints.find(
                (c) => c.table === 'posts' && c.type === 'missing_in_target',
            )
            expect(missing).toBeDefined()
            expect(missing!.definition).toContain('title')
        } finally {
            await execOn(DB_SOURCE, 'ALTER TABLE posts DROP CONSTRAINT chk_title_len')
        }
    })

    it('detects missing check constraint in source', async () => {
        await execOn(DB_TARGET, `ALTER TABLE users ADD CONSTRAINT chk_email CHECK (email <> '')`)

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            const missing = diff.checkConstraints.find(
                (c) => c.table === 'users' && c.type === 'missing_in_source',
            )
            expect(missing).toBeDefined()
            expect(missing!.definition).toContain('email')
        } finally {
            await execOn(DB_TARGET, 'ALTER TABLE users DROP CONSTRAINT chk_email')
        }
    })

    it('detects missing unique constraint in target', async () => {
        await execOn(DB_SOURCE, `ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email)`)

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            const missing = diff.uniqueConstraints.find(
                (c) => c.table === 'users' && c.type === 'missing_in_target',
            )
            expect(missing).toBeDefined()
            expect(missing!.definition).toContain('email')
        } finally {
            await execOn(DB_SOURCE, 'ALTER TABLE users DROP CONSTRAINT uq_users_email')
        }
    })

    it('detects missing unique constraint in source', async () => {
        await execOn(DB_TARGET, `ALTER TABLE posts ADD CONSTRAINT uq_posts_title UNIQUE (title)`)

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            const missing = diff.uniqueConstraints.find(
                (c) => c.table === 'posts' && c.type === 'missing_in_source',
            )
            expect(missing).toBeDefined()
            expect(missing!.definition).toContain('title')
        } finally {
            await execOn(DB_TARGET, 'ALTER TABLE posts DROP CONSTRAINT uq_posts_title')
        }
    })

    it('ignores unique constraint name differences', async () => {
        await execOn(DB_SOURCE, `ALTER TABLE users ADD CONSTRAINT uq_email_v1 UNIQUE (email)`)
        await execOn(DB_TARGET, `ALTER TABLE users ADD CONSTRAINT uq_email_v2 UNIQUE (email)`)

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            const userDiffs = diff.uniqueConstraints.filter((c) => c.table === 'users')
            expect(userDiffs).toHaveLength(0)
        } finally {
            await execOn(DB_SOURCE, 'ALTER TABLE users DROP CONSTRAINT uq_email_v1')
            await execOn(DB_TARGET, 'ALTER TABLE users DROP CONSTRAINT uq_email_v2')
        }
    })

    it('detects missing enum type in target', async () => {
        await execOn(DB_SOURCE, `CREATE TYPE status_enum AS ENUM ('active', 'inactive')`)

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            const missing = diff.enumTypes.find(
                (e) => e.name === 'status_enum' && e.type === 'missing_in_target',
            )
            expect(missing).toBeDefined()
            expect(missing!.sourceValues).toContain('active')
        } finally {
            await execOn(DB_SOURCE, 'DROP TYPE status_enum')
        }
    })

    it('detects enum value mismatch', async () => {
        await execOn(DB_SOURCE, `CREATE TYPE role_enum AS ENUM ('admin', 'user')`)
        await execOn(DB_TARGET, `CREATE TYPE role_enum AS ENUM ('admin', 'user', 'moderator')`)

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            const mismatch = diff.enumTypes.find(
                (e) => e.name === 'role_enum' && e.type === 'mismatch',
            )
            expect(mismatch).toBeDefined()
            expect(mismatch!.sourceValues).toBe('admin, user')
            expect(mismatch!.targetValues).toBe('admin, user, moderator')
        } finally {
            await execOn(DB_SOURCE, 'DROP TYPE role_enum')
            await execOn(DB_TARGET, 'DROP TYPE role_enum')
        }
    })

    it('detects identical enums as no diff', async () => {
        await execOn(DB_SOURCE, `CREATE TYPE priority_enum AS ENUM ('low', 'medium', 'high')`)
        await execOn(DB_TARGET, `CREATE TYPE priority_enum AS ENUM ('low', 'medium', 'high')`)

        try {
            const source = await fetchSchema(connStr(DB_SOURCE))
            const target = await fetchSchema(connStr(DB_TARGET))
            const diff = compareSchemas(source, target)

            const priorityDiffs = diff.enumTypes.filter((e) => e.name === 'priority_enum')
            expect(priorityDiffs).toHaveLength(0)
        } finally {
            await execOn(DB_SOURCE, 'DROP TYPE priority_enum')
            await execOn(DB_TARGET, 'DROP TYPE priority_enum')
        }
    })

    it('detects extension differences', async () => {
        const source = await fetchSchema(connStr(DB_SOURCE))
        const target = await fetchSchema(connStr(DB_TARGET))
        const diff = compareSchemas(source, target)

        // Both databases should have the same extensions by default
        expect(diff.extensions).toHaveLength(0)
    })

    it('fetches tables list', async () => {
        const schema = await fetchSchema(connStr(DB_SOURCE))
        const tableNames = schema.tables.map((t) => t.table_name)

        expect(tableNames).toContain('users')
        expect(tableNames).toContain('posts')
        expect(tableNames).toContain('migrations')
    })

    it('excludes tables from tables list', async () => {
        const schema = await fetchSchema(connStr(DB_SOURCE), ['migrations'])
        const tableNames = schema.tables.map((t) => t.table_name)

        expect(tableNames).not.toContain('migrations')
        expect(tableNames).toContain('users')
    })
})
