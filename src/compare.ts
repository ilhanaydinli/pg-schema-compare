import type {
    CheckConstraintDiff,
    ColumnDiff,
    DiffResult,
    EnumTypeDiff,
    ExtensionDiff,
    ForeignKeyDiff,
    IndexDiff,
    SchemaSnapshot,
    TableDiff,
    UniqueConstraintDiff,
} from './types.js'

export function normalizeDefault(value: string | null): string | null {
    if (value === null) {
        return null
    }
    let normalized = value.trim()

    // Normalize nextval sequences: nextval('any_seq_name'::regclass) → nextval(autoincrement)
    normalized = normalized.replace(/nextval\('[^']*'::regclass\)/g, 'nextval(autoincrement)')

    // Normalize type casts: '0'::bigint → 0, '0'::integer → 0, etc.
    const castMatch = normalized.match(/^'([^']*)'::[\w\s]+$/)
    if (castMatch) {
        normalized = castMatch[1]
    }

    // Normalize numeric type casts without quotes: 0::bigint → 0
    const numericCastMatch = normalized.match(/^(-?\d+(?:\.\d+)?)::[\w\s]+$/)
    if (numericCastMatch) {
        normalized = numericCastMatch[1]
    }

    // Normalize NULL::type → NULL
    const nullCastMatch = normalized.match(/^NULL::[\w\s]+$/i)
    if (nullCastMatch) {
        normalized = 'NULL'
    }

    return normalized
}

export function normalizeIndexDefinition(definition: string): string {
    // Remove the index name: CREATE INDEX idx_name ON ... → CREATE INDEX ON ...
    // Also handles CREATE UNIQUE INDEX idx_name ON ...
    return definition.replace(/CREATE (UNIQUE )?INDEX \S+ ON/, 'CREATE $1INDEX ON').trim()
}

function compareTables(source: SchemaSnapshot, target: SchemaSnapshot): TableDiff[] {
    const diffs: TableDiff[] = []

    const sourceTables = new Set(source.tables.map((t) => t.table_name))
    const targetTables = new Set(target.tables.map((t) => t.table_name))

    for (const table of sourceTables) {
        if (!targetTables.has(table)) {
            diffs.push({ table, type: 'missing_in_target' })
        }
    }

    for (const table of targetTables) {
        if (!sourceTables.has(table)) {
            diffs.push({ table, type: 'missing_in_source' })
        }
    }

    return diffs
}

function compareColumns(
    source: SchemaSnapshot,
    target: SchemaSnapshot,
    tableDiffs: TableDiff[],
): ColumnDiff[] {
    const diffs: ColumnDiff[] = []

    // Skip columns for tables that are entirely missing
    const missingTables = new Set(tableDiffs.map((d) => d.table))

    const sourceMap = new Map<string, (typeof source.columns)[0]>()
    for (const col of source.columns) {
        if (!missingTables.has(col.table_name)) {
            sourceMap.set(`${col.table_name}.${col.column_name}`, col)
        }
    }

    const targetMap = new Map<string, (typeof target.columns)[0]>()
    for (const col of target.columns) {
        if (!missingTables.has(col.table_name)) {
            targetMap.set(`${col.table_name}.${col.column_name}`, col)
        }
    }

    // Find missing in target and mismatches
    for (const [key, srcCol] of sourceMap) {
        const tgtCol = targetMap.get(key)
        if (!tgtCol) {
            diffs.push({
                table: srcCol.table_name,
                column: srcCol.column_name,
                type: 'missing_in_target',
                source: {
                    data_type: srcCol.data_type,
                    is_nullable: srcCol.is_nullable,
                    column_default: srcCol.column_default,
                },
            })
            continue
        }

        const srcDefault = normalizeDefault(srcCol.column_default)
        const tgtDefault = normalizeDefault(tgtCol.column_default)

        if (
            srcCol.data_type !== tgtCol.data_type ||
            srcCol.is_nullable !== tgtCol.is_nullable ||
            srcDefault !== tgtDefault
        ) {
            diffs.push({
                table: srcCol.table_name,
                column: srcCol.column_name,
                type: 'mismatch',
                source: {
                    data_type: srcCol.data_type,
                    is_nullable: srcCol.is_nullable,
                    column_default: srcCol.column_default,
                },
                target: {
                    data_type: tgtCol.data_type,
                    is_nullable: tgtCol.is_nullable,
                    column_default: tgtCol.column_default,
                },
            })
        }
    }

    // Find missing in source
    for (const [key, tgtCol] of targetMap) {
        if (!sourceMap.has(key)) {
            diffs.push({
                table: tgtCol.table_name,
                column: tgtCol.column_name,
                type: 'missing_in_source',
                target: {
                    data_type: tgtCol.data_type,
                    is_nullable: tgtCol.is_nullable,
                    column_default: tgtCol.column_default,
                },
            })
        }
    }

    return diffs
}

function compareIndexes(source: SchemaSnapshot, target: SchemaSnapshot): IndexDiff[] {
    const diffs: IndexDiff[] = []

    const sourceSet = new Map<string, string>()
    for (const idx of source.indexes) {
        const normalized = normalizeIndexDefinition(idx.index_definition)
        sourceSet.set(`${idx.table_name}::${normalized}`, idx.table_name)
    }

    const targetSet = new Map<string, string>()
    for (const idx of target.indexes) {
        const normalized = normalizeIndexDefinition(idx.index_definition)
        targetSet.set(`${idx.table_name}::${normalized}`, idx.table_name)
    }

    for (const [key, table] of sourceSet) {
        if (!targetSet.has(key)) {
            const definition = key.split('::').slice(1).join('::')
            diffs.push({ table, definition, type: 'missing_in_target' })
        }
    }

    for (const [key, table] of targetSet) {
        if (!sourceSet.has(key)) {
            const definition = key.split('::').slice(1).join('::')
            diffs.push({ table, definition, type: 'missing_in_source' })
        }
    }

    return diffs
}

function compareForeignKeys(source: SchemaSnapshot, target: SchemaSnapshot): ForeignKeyDiff[] {
    const diffs: ForeignKeyDiff[] = []

    const sourceSet = new Map<string, string>()
    for (const fk of source.foreignKeys) {
        const normalized = fk.fk_definition.trim()
        sourceSet.set(`${fk.table_name}::${normalized}`, fk.table_name)
    }

    const targetSet = new Map<string, string>()
    for (const fk of target.foreignKeys) {
        const normalized = fk.fk_definition.trim()
        targetSet.set(`${fk.table_name}::${normalized}`, fk.table_name)
    }

    for (const [key, table] of sourceSet) {
        if (!targetSet.has(key)) {
            const definition = key.split('::').slice(1).join('::')
            diffs.push({ table, definition, type: 'missing_in_target' })
        }
    }

    for (const [key, table] of targetSet) {
        if (!sourceSet.has(key)) {
            const definition = key.split('::').slice(1).join('::')
            diffs.push({ table, definition, type: 'missing_in_source' })
        }
    }

    return diffs
}

function compareCheckConstraints(
    source: SchemaSnapshot,
    target: SchemaSnapshot,
): CheckConstraintDiff[] {
    const diffs: CheckConstraintDiff[] = []

    const sourceSet = new Map<string, string>()
    for (const cc of source.checkConstraints) {
        sourceSet.set(`${cc.table_name}::${cc.check_definition.trim()}`, cc.table_name)
    }

    const targetSet = new Map<string, string>()
    for (const cc of target.checkConstraints) {
        targetSet.set(`${cc.table_name}::${cc.check_definition.trim()}`, cc.table_name)
    }

    for (const [key, table] of sourceSet) {
        if (!targetSet.has(key)) {
            const definition = key.split('::').slice(1).join('::')
            diffs.push({ table, definition, type: 'missing_in_target' })
        }
    }

    for (const [key, table] of targetSet) {
        if (!sourceSet.has(key)) {
            const definition = key.split('::').slice(1).join('::')
            diffs.push({ table, definition, type: 'missing_in_source' })
        }
    }

    return diffs
}

function compareUniqueConstraints(
    source: SchemaSnapshot,
    target: SchemaSnapshot,
): UniqueConstraintDiff[] {
    const diffs: UniqueConstraintDiff[] = []

    const sourceSet = new Map<string, string>()
    for (const uc of source.uniqueConstraints) {
        sourceSet.set(`${uc.table_name}::${uc.unique_definition.trim()}`, uc.table_name)
    }

    const targetSet = new Map<string, string>()
    for (const uc of target.uniqueConstraints) {
        targetSet.set(`${uc.table_name}::${uc.unique_definition.trim()}`, uc.table_name)
    }

    for (const [key, table] of sourceSet) {
        if (!targetSet.has(key)) {
            const definition = key.split('::').slice(1).join('::')
            diffs.push({ table, definition, type: 'missing_in_target' })
        }
    }

    for (const [key, table] of targetSet) {
        if (!sourceSet.has(key)) {
            const definition = key.split('::').slice(1).join('::')
            diffs.push({ table, definition, type: 'missing_in_source' })
        }
    }

    return diffs
}

function compareEnumTypes(source: SchemaSnapshot, target: SchemaSnapshot): EnumTypeDiff[] {
    const diffs: EnumTypeDiff[] = []

    const sourceMap = new Map<string, string>()
    for (const e of source.enumTypes) {
        sourceMap.set(e.enum_name, e.enum_values)
    }

    const targetMap = new Map<string, string>()
    for (const e of target.enumTypes) {
        targetMap.set(e.enum_name, e.enum_values)
    }

    for (const [name, sourceValues] of sourceMap) {
        const targetValues = targetMap.get(name)
        if (targetValues === undefined) {
            diffs.push({ name, type: 'missing_in_target', sourceValues })
        } else if (sourceValues !== targetValues) {
            diffs.push({ name, type: 'mismatch', sourceValues, targetValues })
        }
    }

    for (const [name, targetValues] of targetMap) {
        if (!sourceMap.has(name)) {
            diffs.push({ name, type: 'missing_in_source', targetValues })
        }
    }

    return diffs
}

function compareExtensions(source: SchemaSnapshot, target: SchemaSnapshot): ExtensionDiff[] {
    const diffs: ExtensionDiff[] = []

    const sourceMap = new Map<string, string>()
    for (const e of source.extensions) {
        sourceMap.set(e.extension_name, e.extension_version)
    }

    const targetMap = new Map<string, string>()
    for (const e of target.extensions) {
        targetMap.set(e.extension_name, e.extension_version)
    }

    for (const [name, sourceVersion] of sourceMap) {
        const targetVersion = targetMap.get(name)
        if (targetVersion === undefined) {
            diffs.push({ name, type: 'missing_in_target', sourceVersion })
        } else if (sourceVersion !== targetVersion) {
            diffs.push({ name, type: 'mismatch', sourceVersion, targetVersion })
        }
    }

    for (const [name, targetVersion] of targetMap) {
        if (!sourceMap.has(name)) {
            diffs.push({ name, type: 'missing_in_source', targetVersion })
        }
    }

    return diffs
}

export function compareSchemas(source: SchemaSnapshot, target: SchemaSnapshot): DiffResult {
    const tables = compareTables(source, target)

    return {
        tables,
        columns: compareColumns(source, target, tables),
        indexes: compareIndexes(source, target),
        foreignKeys: compareForeignKeys(source, target),
        checkConstraints: compareCheckConstraints(source, target),
        uniqueConstraints: compareUniqueConstraints(source, target),
        enumTypes: compareEnumTypes(source, target),
        extensions: compareExtensions(source, target),
    }
}
