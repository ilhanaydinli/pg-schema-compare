import pg from 'pg'

import type {
    CheckConstraintInfo,
    ColumnInfo,
    EnumTypeInfo,
    ExtensionInfo,
    ForeignKeyInfo,
    IndexInfo,
    SchemaSnapshot,
    TableInfo,
    UniqueConstraintInfo,
} from './types.js'

const { Client } = pg

function validateConnectionString(input: string): string {
    if (input.startsWith('postgres://') || input.startsWith('postgresql://')) {
        return input
    }
    throw new Error(
        `Invalid connection string: "${input}". Must be a full PostgreSQL connection string (e.g. postgres://user:pass@host/db).`,
    )
}

function buildExcludeClause(excludeTables: string[]): string {
    if (excludeTables.length === 0) {
        return ''
    }
    const placeholders = excludeTables.map((_, i) => `$${i + 1}`)
    return `AND t.table_name NOT IN (${placeholders.join(', ')})`
}

function buildPlainExcludeClause(excludeTables: string[], column: string): string {
    if (excludeTables.length === 0) {
        return ''
    }
    return `AND ${column} NOT IN (${excludeTables.map((t) => `'${t}'`).join(', ')})`
}

const TABLES_SQL = `
  SELECT t.table_name
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    __EXCLUDE__
  ORDER BY t.table_name
`

const COLUMNS_SQL = `
  SELECT
    t.table_name,
    c.column_name,
    c.data_type,
    c.is_nullable,
    c.column_default
  FROM information_schema.tables t
  JOIN information_schema.columns c
    ON c.table_schema = t.table_schema AND c.table_name = t.table_name
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    __EXCLUDE__
  ORDER BY t.table_name, c.ordinal_position
`

const INDEXES_SQL = `
  SELECT
    t.relname AS table_name,
    i.relname AS index_name,
    pg_get_indexdef(ix.indexrelid) AS index_definition
  FROM pg_index ix
  JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND NOT ix.indisprimary
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conindid = ix.indexrelid AND c.contype = 'u'
    )
    __EXCLUDE_PLAIN__
  ORDER BY t.relname, i.relname
`

const FOREIGN_KEYS_SQL = `
  SELECT
    tc.table_name,
    tc.constraint_name,
    pg_get_constraintdef(pgc.oid) AS fk_definition
  FROM information_schema.table_constraints tc
  JOIN pg_constraint pgc
    ON pgc.conname = tc.constraint_name
    AND pgc.connamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    __EXCLUDE_PLAIN__
  ORDER BY tc.table_name, tc.constraint_name
`

const CHECK_CONSTRAINTS_SQL = `
  SELECT
    tc.table_name,
    tc.constraint_name,
    pg_get_constraintdef(pgc.oid) AS check_definition
  FROM information_schema.table_constraints tc
  JOIN pg_constraint pgc
    ON pgc.conname = tc.constraint_name
    AND pgc.connamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  WHERE tc.constraint_type = 'CHECK'
    AND tc.table_schema = 'public'
    __EXCLUDE_PLAIN__
  ORDER BY tc.table_name, tc.constraint_name
`

const UNIQUE_CONSTRAINTS_SQL = `
  SELECT
    tc.table_name,
    tc.constraint_name,
    pg_get_constraintdef(pgc.oid) AS unique_definition
  FROM information_schema.table_constraints tc
  JOIN pg_constraint pgc
    ON pgc.conname = tc.constraint_name
    AND pgc.connamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  WHERE tc.constraint_type = 'UNIQUE'
    AND tc.table_schema = 'public'
    __EXCLUDE_PLAIN__
  ORDER BY tc.table_name, tc.constraint_name
`

const ENUM_TYPES_SQL = `
  SELECT
    t.typname AS enum_name,
    string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS enum_values
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
  GROUP BY t.typname
  ORDER BY t.typname
`

const EXTENSIONS_SQL = `
  SELECT
    extname AS extension_name,
    extversion AS extension_version
  FROM pg_extension
  WHERE extname != 'plpgsql'
  ORDER BY extname
`

const NOT_NULL_CHECK_PATTERN = /^CHECK \(\([a-z_][\w]* IS NOT NULL\)\)$/

export async function fetchSchema(
    connectionInput: string,
    excludeTables: string[] = [],
): Promise<SchemaSnapshot> {
    const connectionString = validateConnectionString(connectionInput)
    const client = new Client({ connectionString })
    await client.connect()

    try {
        const excludeClause = buildExcludeClause(excludeTables)
        const excludePlainRelClause = buildPlainExcludeClause(excludeTables, 't.relname')
        const excludePlainTcClause = buildPlainExcludeClause(excludeTables, 'tc.table_name')

        const tablesResult = await client.query<TableInfo>(
            TABLES_SQL.replace('__EXCLUDE__', excludeClause),
            excludeTables,
        )

        const columnsResult = await client.query<ColumnInfo>(
            COLUMNS_SQL.replace('__EXCLUDE__', excludeClause),
            excludeTables,
        )

        const indexesResult = await client.query<IndexInfo>(
            INDEXES_SQL.replace('__EXCLUDE_PLAIN__', excludePlainRelClause),
        )

        const foreignKeysResult = await client.query<ForeignKeyInfo>(
            FOREIGN_KEYS_SQL.replace('__EXCLUDE_PLAIN__', excludePlainTcClause),
        )

        const checkConstraintsResult = await client.query<CheckConstraintInfo>(
            CHECK_CONSTRAINTS_SQL.replace('__EXCLUDE_PLAIN__', excludePlainTcClause),
        )

        const uniqueConstraintsResult = await client.query<UniqueConstraintInfo>(
            UNIQUE_CONSTRAINTS_SQL.replace('__EXCLUDE_PLAIN__', excludePlainTcClause),
        )

        const enumTypesResult = await client.query<EnumTypeInfo>(ENUM_TYPES_SQL)

        const extensionsResult = await client.query<ExtensionInfo>(EXTENSIONS_SQL)

        // Filter out NOT NULL check constraints (PostgreSQL internal representation)
        const checkConstraints = checkConstraintsResult.rows.filter(
            (c) => !NOT_NULL_CHECK_PATTERN.test(c.check_definition),
        )

        return {
            tables: tablesResult.rows,
            columns: columnsResult.rows,
            indexes: indexesResult.rows,
            foreignKeys: foreignKeysResult.rows,
            checkConstraints,
            uniqueConstraints: uniqueConstraintsResult.rows,
            enumTypes: enumTypesResult.rows,
            extensions: extensionsResult.rows,
        }
    } finally {
        await client.end()
    }
}

export function getDatabaseName(input: string): string {
    if (input.startsWith('postgres://') || input.startsWith('postgresql://')) {
        try {
            const url = new URL(input)
            return url.pathname.slice(1) || input
        } catch {
            return input
        }
    }
    return input
}
