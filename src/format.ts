import chalk from 'chalk'
import Table from 'cli-table3'

import type {
    ColumnDiff,
    DiffResult,
    EnumTypeDiff,
    ExtensionDiff,
    ForeignKeyDiff,
    IndexDiff,
    SchemaSnapshot,
    TableDiff,
} from './types.js'

export interface FormatOptions {
    diff: DiffResult
    sourceName: string
    targetName: string
    source: SchemaSnapshot
    target: SchemaSnapshot
}

const TABLE_CHARS = {
    top: '─',
    'top-mid': '┬',
    'top-left': '  ┌',
    'top-right': '┐',
    bottom: '─',
    'bottom-mid': '┴',
    'bottom-left': '  └',
    'bottom-right': '┘',
    left: '  │',
    'left-mid': '  ├',
    mid: '─',
    'mid-mid': '┼',
    right: '│',
    'right-mid': '┤',
    middle: '│',
}

const TABLE_STYLE = { head: ['cyan'] as string[], 'padding-left': 1, 'padding-right': 1 }

export function formatDiffText(options: FormatOptions): string {
    const { diff, sourceName, targetName, source, target } = options
    const lines: string[] = []

    // Header
    lines.push('')
    lines.push(chalk.cyan('╔══════════════════════════════════════════════════════╗'))
    lines.push(
        chalk.cyan('║') +
            '  pg-schema-compare                                   ' +
            chalk.cyan('║'),
    )
    lines.push(chalk.cyan('║') + `  FROM: ${chalk.yellow(sourceName.padEnd(45))}` + chalk.cyan('║'))
    lines.push(chalk.cyan('║') + `  TO:   ${chalk.yellow(targetName.padEnd(45))}` + chalk.cyan('║'))
    lines.push(chalk.cyan('╚══════════════════════════════════════════════════════╝'))
    lines.push('')

    // Tables section
    formatTablesSection(lines, diff.tables, sourceName, targetName, source, target)

    // Columns section
    formatColumnsSection(lines, diff.columns, sourceName, targetName, source, target)

    // Indexes section
    formatDefinitionSection(
        lines,
        'Indexes',
        diff.indexes,
        sourceName,
        targetName,
        source.indexes.length,
        target.indexes.length,
    )

    // Foreign Keys section
    formatDefinitionSection(
        lines,
        'Foreign Keys',
        diff.foreignKeys,
        sourceName,
        targetName,
        source.foreignKeys.length,
        target.foreignKeys.length,
    )

    // Check Constraints section
    formatDefinitionSection(
        lines,
        'Check Constraints',
        diff.checkConstraints,
        sourceName,
        targetName,
        source.checkConstraints.length,
        target.checkConstraints.length,
    )

    // Unique Constraints section
    formatDefinitionSection(
        lines,
        'Unique Constraints',
        diff.uniqueConstraints,
        sourceName,
        targetName,
        source.uniqueConstraints.length,
        target.uniqueConstraints.length,
    )

    // Enum Types section
    formatEnumTypesSection(lines, diff.enumTypes, sourceName, targetName, source, target)

    // Extensions section
    formatExtensionsSection(lines, diff.extensions, sourceName, targetName, source, target)

    // Summary
    const totalDiffs =
        diff.tables.length +
        diff.columns.length +
        diff.indexes.length +
        diff.foreignKeys.length +
        diff.checkConstraints.length +
        diff.uniqueConstraints.length +
        diff.enumTypes.length +
        diff.extensions.length

    if (totalDiffs === 0) {
        lines.push(chalk.green('✓ Schemas are identical'))
    } else {
        lines.push(chalk.red(`✗ ${totalDiffs} total difference${totalDiffs > 1 ? 's' : ''} found`))
    }
    lines.push('')

    return lines.join('\n')
}

function sectionHeader(title: string): string {
    return chalk.bold(`── ${title} ${'─'.repeat(Math.max(0, 53 - title.length))}`)
}

function formatTablesSection(
    lines: string[],
    diffs: TableDiff[],
    sourceName: string,
    targetName: string,
    source: SchemaSnapshot,
    target: SchemaSnapshot,
): void {
    lines.push(sectionHeader('Tables'))
    if (diffs.length === 0) {
        const total = Math.max(source.tables.length, target.tables.length)
        lines.push(`  ${chalk.green('✓')} No differences (${total} tables compared)`)
    } else {
        lines.push(
            `  ${chalk.red('✗')} ${diffs.length} difference${diffs.length > 1 ? 's' : ''} found`,
        )
        lines.push('')

        const missingInTarget = diffs.filter((d) => d.type === 'missing_in_target')
        const missingInSource = diffs.filter((d) => d.type === 'missing_in_source')

        if (missingInTarget.length > 0) {
            lines.push(`  ${chalk.red(`Missing in [${targetName}]`)} (exists in [${sourceName}]):`)
            const table = new Table({
                head: ['Table'],
                style: TABLE_STYLE,
                chars: TABLE_CHARS,
            })
            for (const d of missingInTarget) {
                table.push([d.table])
            }
            lines.push(table.toString())
            lines.push('')
        }

        if (missingInSource.length > 0) {
            lines.push(`  ${chalk.red(`Missing in [${sourceName}]`)} (exists in [${targetName}]):`)
            const table = new Table({
                head: ['Table'],
                style: TABLE_STYLE,
                chars: TABLE_CHARS,
            })
            for (const d of missingInSource) {
                table.push([d.table])
            }
            lines.push(table.toString())
            lines.push('')
        }
    }
    lines.push('')
}

function formatColumnsSection(
    lines: string[],
    diffs: ColumnDiff[],
    sourceName: string,
    targetName: string,
    source: SchemaSnapshot,
    target: SchemaSnapshot,
): void {
    lines.push(sectionHeader('Columns'))
    if (diffs.length === 0) {
        const total = Math.max(source.columns.length, target.columns.length)
        lines.push(`  ${chalk.green('✓')} No differences (${total} columns compared)`)
    } else {
        lines.push(
            `  ${chalk.red('✗')} ${diffs.length} difference${diffs.length > 1 ? 's' : ''} found`,
        )
        lines.push('')

        const missingInTarget = diffs.filter((d) => d.type === 'missing_in_target')
        const missingInSource = diffs.filter((d) => d.type === 'missing_in_source')
        const mismatches = diffs.filter((d) => d.type === 'mismatch')

        if (missingInTarget.length > 0) {
            lines.push(`  ${chalk.red(`Missing in [${targetName}]`)} (exists in [${sourceName}]):`)
            lines.push(formatColumnTable(missingInTarget, 'source'))
            lines.push('')
        }

        if (missingInSource.length > 0) {
            lines.push(`  ${chalk.red(`Missing in [${sourceName}]`)} (exists in [${targetName}]):`)
            lines.push(formatColumnTable(missingInSource, 'target'))
            lines.push('')
        }

        if (mismatches.length > 0) {
            lines.push(`  ${chalk.yellow('Type mismatches')}:`)
            lines.push(formatMismatchTable(mismatches, sourceName, targetName))
            lines.push('')
        }
    }
    lines.push('')
}

function formatDefinitionSection(
    lines: string[],
    title: string,
    diffs: (IndexDiff | ForeignKeyDiff)[],
    sourceName: string,
    targetName: string,
    sourceCount: number,
    targetCount: number,
): void {
    lines.push(sectionHeader(title))
    if (diffs.length === 0) {
        const total = Math.max(sourceCount, targetCount)
        lines.push(
            `  ${chalk.green('✓')} No differences (${total} ${title.toLowerCase()} compared)`,
        )
    } else {
        lines.push(
            `  ${chalk.red('✗')} ${diffs.length} difference${diffs.length > 1 ? 's' : ''} found`,
        )
        lines.push('')

        const missingInTarget = diffs.filter((d) => d.type === 'missing_in_target')
        const missingInSource = diffs.filter((d) => d.type === 'missing_in_source')

        if (missingInTarget.length > 0) {
            lines.push(`  ${chalk.red(`Missing in [${targetName}]`)} (exists in [${sourceName}]):`)
            lines.push(formatDefTable(missingInTarget))
            lines.push('')
        }

        if (missingInSource.length > 0) {
            lines.push(`  ${chalk.red(`Missing in [${sourceName}]`)} (exists in [${targetName}]):`)
            lines.push(formatDefTable(missingInSource))
            lines.push('')
        }
    }
    lines.push('')
}

function formatEnumTypesSection(
    lines: string[],
    diffs: EnumTypeDiff[],
    sourceName: string,
    targetName: string,
    source: SchemaSnapshot,
    target: SchemaSnapshot,
): void {
    lines.push(sectionHeader('Enum Types'))
    if (diffs.length === 0) {
        const total = Math.max(source.enumTypes.length, target.enumTypes.length)
        lines.push(`  ${chalk.green('✓')} No differences (${total} enum types compared)`)
    } else {
        lines.push(
            `  ${chalk.red('✗')} ${diffs.length} difference${diffs.length > 1 ? 's' : ''} found`,
        )
        lines.push('')

        const missingInTarget = diffs.filter((d) => d.type === 'missing_in_target')
        const missingInSource = diffs.filter((d) => d.type === 'missing_in_source')
        const mismatches = diffs.filter((d) => d.type === 'mismatch')

        if (missingInTarget.length > 0) {
            lines.push(`  ${chalk.red(`Missing in [${targetName}]`)} (exists in [${sourceName}]):`)
            const table = new Table({
                head: ['Name', 'Values'],
                style: TABLE_STYLE,
                chars: TABLE_CHARS,
            })
            for (const d of missingInTarget) {
                table.push([d.name, d.sourceValues ?? ''])
            }
            lines.push(table.toString())
            lines.push('')
        }

        if (missingInSource.length > 0) {
            lines.push(`  ${chalk.red(`Missing in [${sourceName}]`)} (exists in [${targetName}]):`)
            const table = new Table({
                head: ['Name', 'Values'],
                style: TABLE_STYLE,
                chars: TABLE_CHARS,
            })
            for (const d of missingInSource) {
                table.push([d.name, d.targetValues ?? ''])
            }
            lines.push(table.toString())
            lines.push('')
        }

        if (mismatches.length > 0) {
            lines.push(`  ${chalk.yellow('Value mismatches')}:`)
            const table = new Table({
                head: ['Name', sourceName, targetName],
                style: TABLE_STYLE,
                chars: TABLE_CHARS,
            })
            for (const d of mismatches) {
                table.push([d.name, d.sourceValues ?? '', d.targetValues ?? ''])
            }
            lines.push(table.toString())
            lines.push('')
        }
    }
    lines.push('')
}

function formatExtensionsSection(
    lines: string[],
    diffs: ExtensionDiff[],
    sourceName: string,
    targetName: string,
    source: SchemaSnapshot,
    target: SchemaSnapshot,
): void {
    lines.push(sectionHeader('Extensions'))
    if (diffs.length === 0) {
        const total = Math.max(source.extensions.length, target.extensions.length)
        lines.push(`  ${chalk.green('✓')} No differences (${total} extensions compared)`)
    } else {
        lines.push(
            `  ${chalk.red('✗')} ${diffs.length} difference${diffs.length > 1 ? 's' : ''} found`,
        )
        lines.push('')

        const missingInTarget = diffs.filter((d) => d.type === 'missing_in_target')
        const missingInSource = diffs.filter((d) => d.type === 'missing_in_source')
        const mismatches = diffs.filter((d) => d.type === 'mismatch')

        if (missingInTarget.length > 0) {
            lines.push(`  ${chalk.red(`Missing in [${targetName}]`)} (exists in [${sourceName}]):`)
            const table = new Table({
                head: ['Name', 'Version'],
                style: TABLE_STYLE,
                chars: TABLE_CHARS,
            })
            for (const d of missingInTarget) {
                table.push([d.name, d.sourceVersion ?? ''])
            }
            lines.push(table.toString())
            lines.push('')
        }

        if (missingInSource.length > 0) {
            lines.push(`  ${chalk.red(`Missing in [${sourceName}]`)} (exists in [${targetName}]):`)
            const table = new Table({
                head: ['Name', 'Version'],
                style: TABLE_STYLE,
                chars: TABLE_CHARS,
            })
            for (const d of missingInSource) {
                table.push([d.name, d.targetVersion ?? ''])
            }
            lines.push(table.toString())
            lines.push('')
        }

        if (mismatches.length > 0) {
            lines.push(`  ${chalk.yellow('Version mismatches')}:`)
            const table = new Table({
                head: ['Name', sourceName, targetName],
                style: TABLE_STYLE,
                chars: TABLE_CHARS,
            })
            for (const d of mismatches) {
                table.push([d.name, d.sourceVersion ?? '', d.targetVersion ?? ''])
            }
            lines.push(table.toString())
            lines.push('')
        }
    }
    lines.push('')
}

function formatColumnTable(diffs: ColumnDiff[], side: 'source' | 'target'): string {
    const table = new Table({
        head: ['Table', 'Column', 'Type', 'Nullable', 'Default'],
        style: TABLE_STYLE,
        chars: TABLE_CHARS,
    })

    for (const d of diffs) {
        const info = side === 'source' ? d.source! : d.target!
        table.push([
            d.table,
            d.column,
            info.data_type,
            info.is_nullable,
            info.column_default ?? 'NULL',
        ])
    }

    return table.toString()
}

function formatMismatchTable(diffs: ColumnDiff[], sourceName: string, targetName: string): string {
    const table = new Table({
        head: ['Table', 'Column', sourceName, targetName],
        style: TABLE_STYLE,
        chars: TABLE_CHARS,
    })

    for (const d of diffs) {
        const src = d.source!
        const tgt = d.target!
        const srcDesc = `${src.data_type}, ${src.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}${src.column_default ? `, default: ${src.column_default}` : ''}`
        const tgtDesc = `${tgt.data_type}, ${tgt.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}${tgt.column_default ? `, default: ${tgt.column_default}` : ''}`
        table.push([d.table, d.column, srcDesc, tgtDesc])
    }

    return table.toString()
}

function formatDefTable(diffs: (IndexDiff | ForeignKeyDiff)[]): string {
    const table = new Table({
        head: ['Table', 'Definition'],
        style: TABLE_STYLE,
        chars: TABLE_CHARS,
    })

    for (const d of diffs) {
        table.push([d.table, d.definition])
    }

    return table.toString()
}
