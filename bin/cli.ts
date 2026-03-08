#!/usr/bin/env node

import { program } from 'commander'

import { compareSchemas } from '../src/compare.js'
import { formatDiffText } from '../src/format.js'
import { fetchSchema, getDatabaseName } from '../src/queries.js'

program
    .name('pg-schema-compare')
    .description(
        'Compare two PostgreSQL database schemas structurally, ignoring naming differences',
    )
    .version('1.0.0')
    .requiredOption('--from <connection>', 'Source database (connection string)')
    .requiredOption('--to <connection>', 'Target database (connection string)')
    .option('--exclude <tables>', 'Comma-separated list of tables to exclude', '')
    .parse()

const opts = program.opts()
const excludeTables = opts.exclude ? opts.exclude.split(',').map((t: string) => t.trim()) : []

async function main(): Promise<void> {
    const sourceName = getDatabaseName(opts.from)
    const targetName = getDatabaseName(opts.to)

    try {
        const [source, target] = await Promise.all([
            fetchSchema(opts.from, excludeTables),
            fetchSchema(opts.to, excludeTables),
        ])

        const diff = compareSchemas(source, target)

        console.log(formatDiffText({ diff, sourceName, targetName, source, target }))

        const totalDiffs =
            diff.tables.length +
            diff.columns.length +
            diff.indexes.length +
            diff.foreignKeys.length +
            diff.checkConstraints.length +
            diff.uniqueConstraints.length +
            diff.enumTypes.length +
            diff.extensions.length

        process.exit(totalDiffs > 0 ? 1 : 0)
    } catch (error) {
        if (error instanceof Error) {
            console.error(`\nError: ${error.message}\n`)
        } else {
            console.error('\nUnknown error occurred\n')
        }
        process.exit(2)
    }
}

main()
