export interface TableInfo {
    table_name: string
}

export interface ColumnInfo {
    table_name: string
    column_name: string
    data_type: string
    is_nullable: string
    column_default: string | null
}

export interface IndexInfo {
    table_name: string
    index_name: string
    index_definition: string
}

export interface ForeignKeyInfo {
    table_name: string
    constraint_name: string
    fk_definition: string
}

export interface CheckConstraintInfo {
    table_name: string
    constraint_name: string
    check_definition: string
}

export interface UniqueConstraintInfo {
    table_name: string
    constraint_name: string
    unique_definition: string
}

export interface EnumTypeInfo {
    enum_name: string
    enum_values: string
}

export interface ExtensionInfo {
    extension_name: string
    extension_version: string
}

export interface SchemaSnapshot {
    tables: TableInfo[]
    columns: ColumnInfo[]
    indexes: IndexInfo[]
    foreignKeys: ForeignKeyInfo[]
    checkConstraints: CheckConstraintInfo[]
    uniqueConstraints: UniqueConstraintInfo[]
    enumTypes: EnumTypeInfo[]
    extensions: ExtensionInfo[]
}

export interface TableDiff {
    table: string
    type: 'missing_in_target' | 'missing_in_source'
}

export interface ColumnDiff {
    table: string
    column: string
    type: 'missing_in_target' | 'missing_in_source' | 'mismatch'
    source?: { data_type: string; is_nullable: string; column_default: string | null }
    target?: { data_type: string; is_nullable: string; column_default: string | null }
}

export interface IndexDiff {
    table: string
    definition: string
    type: 'missing_in_target' | 'missing_in_source'
}

export interface ForeignKeyDiff {
    table: string
    definition: string
    type: 'missing_in_target' | 'missing_in_source'
}

export interface CheckConstraintDiff {
    table: string
    definition: string
    type: 'missing_in_target' | 'missing_in_source'
}

export interface UniqueConstraintDiff {
    table: string
    definition: string
    type: 'missing_in_target' | 'missing_in_source'
}

export interface EnumTypeDiff {
    name: string
    type: 'missing_in_target' | 'missing_in_source' | 'mismatch'
    sourceValues?: string
    targetValues?: string
}

export interface ExtensionDiff {
    name: string
    type: 'missing_in_target' | 'missing_in_source' | 'mismatch'
    sourceVersion?: string
    targetVersion?: string
}

export interface DiffResult {
    tables: TableDiff[]
    columns: ColumnDiff[]
    indexes: IndexDiff[]
    foreignKeys: ForeignKeyDiff[]
    checkConstraints: CheckConstraintDiff[]
    uniqueConstraints: UniqueConstraintDiff[]
    enumTypes: EnumTypeDiff[]
    extensions: ExtensionDiff[]
}
