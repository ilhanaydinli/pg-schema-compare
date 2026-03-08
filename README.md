# pg-schema-compare

Structurally compare two PostgreSQL database schemas, ignoring constraint and index naming differences.

Useful for verifying that a fresh migration produces the same schema as an existing database.

## Why This Tool?

Most schema diff tools (e.g. `migra`, `pgquarrel`, `pg-schema-diff`) focus on generating migration SQL to bring one schema in line with another. This tool takes a different approach:

- **Structure-only comparison** -- compares what matters (tables, columns, indexes, foreign keys, constraints, enums, extensions) without generating migration output.
- **Name-agnostic** -- ignores index and constraint names entirely. Two databases with different naming conventions but identical structure are reported as equal.
- **Normalization built-in** -- handles common PostgreSQL quirks like sequence names, type casts, and default value formatting so you don't get false positives.
- **CI-friendly** -- simple exit codes (`0` = identical, `1` = differences, `2` = error) make it easy to integrate into CI pipelines for migration drift detection.

Ideal for teams that want to answer one question: _"Does running migrations from scratch produce the exact same schema as our existing database?"_

## Install

```bash
bun add -g pg-schema-compare
```

Or run directly with `bunx`:

```bash
bunx pg-schema-compare \
  --from postgres://user:pass@host:5432/db1 \
  --to postgres://user:pass@host:5432/db2
```

## Usage

```bash
# Compare two databases
pg-schema-compare \
  --from postgres://user:pass@host:5432/db_existing \
  --to postgres://user:pass@host:5432/db_fresh

# Exclude specific tables
pg-schema-compare \
  --from postgres://user:pass@host:5432/db1 \
  --to postgres://user:pass@host:5432/db2 \
  --exclude migrations,logs
```

> A full PostgreSQL connection string is required. Plain database names are not supported.

### Options

| Option      | Required | Description                                               |
| ----------- | -------- | --------------------------------------------------------- |
| `--from`    | Yes      | Source database connection string                         |
| `--to`      | Yes      | Target database connection string                         |
| `--exclude` | No       | Comma-separated list of tables to exclude from comparison |

## What It Compares

| Category               | Details                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| **Tables**             | Detects entire tables that exist in one database but not the other                |
| **Columns**            | Data type, nullability, default value (with sequence and type cast normalization) |
| **Indexes**            | Normalized index definitions (index names are ignored)                            |
| **Foreign Keys**       | Foreign key constraint definitions (constraint names are ignored)                 |
| **Check Constraints**  | CHECK constraint definitions (NOT NULL checks are excluded)                       |
| **Unique Constraints** | UNIQUE constraint definitions (constraint names are ignored)                      |
| **Enum Types**         | Custom PostgreSQL enum types and their values                                     |
| **Extensions**         | Installed PostgreSQL extensions and their versions                                |

### Normalization

The following normalizations are applied during comparison to avoid false positives:

- **Sequences:** `nextval('any_seq_name'::regclass)` -> `nextval(autoincrement)`
- **Type casts:** `'0'::bigint` -> `0`, `NULL::character varying` -> `NULL`
- **Index names:** `CREATE INDEX idx_name ON ...` -> `CREATE INDEX ON ...`
- **Constraint names:** All constraint names are stripped; only definitions are compared
- **NOT NULL checks:** Internal `CHECK ((col IS NOT NULL))` constraints are filtered out

### Table-Level Awareness

When an entire table is missing from one database, it is reported as a single table-level diff instead of listing every column individually. Column-level diffs are only shown for tables that exist in both databases.

## Exit Codes

| Code | Meaning                     |
| ---- | --------------------------- |
| `0`  | Schemas are identical       |
| `1`  | Differences found           |
| `2`  | Connection or runtime error |

## Programmatic API

```typescript
import { fetchSchema, compareSchemas, formatDiffText } from 'pg-schema-compare'

const source = await fetchSchema('postgres://user:pass@localhost:5432/db1')
const target = await fetchSchema('postgres://user:pass@localhost:5432/db2')
const diff = compareSchemas(source, target)

// diff.tables           -> TableDiff[]
// diff.columns          -> ColumnDiff[]
// diff.indexes          -> IndexDiff[]
// diff.foreignKeys      -> ForeignKeyDiff[]
// diff.checkConstraints -> CheckConstraintDiff[]
// diff.uniqueConstraints -> UniqueConstraintDiff[]
// diff.enumTypes        -> EnumTypeDiff[]
// diff.extensions       -> ExtensionDiff[]

// Format as CLI output
const output = formatDiffText({
    diff,
    sourceName: 'db1',
    targetName: 'db2',
    source,
    target,
})
```

## Development

```bash
# Install dependencies
bun install

# Run tests (requires PostgreSQL)
cp .env.test.example .env.test   # adjust PG_URL if needed
bun test

# Lint, format, type check
bun run check

# Auto-fix lint and format issues
bun run fix
```
