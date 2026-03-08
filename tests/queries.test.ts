import { describe, expect, it } from 'bun:test'

import { getDatabaseName } from '../src/queries.js'

describe('getDatabaseName', () => {
    it('returns plain database name as-is', () => {
        expect(getDatabaseName('altpay_backend')).toBe('altpay_backend')
    })

    it('extracts database name from postgres:// URL', () => {
        expect(getDatabaseName('postgres://user:pass@localhost:5432/mydb')).toBe('mydb')
    })

    it('extracts database name from postgresql:// URL', () => {
        expect(getDatabaseName('postgresql://user@host/testdb')).toBe('testdb')
    })

    it('returns original string for URL without path', () => {
        expect(getDatabaseName('postgres://localhost')).toBe('postgres://localhost')
    })

    it('handles URL with only host and port', () => {
        expect(getDatabaseName('postgres://localhost:5432/')).toBe('postgres://localhost:5432/')
    })
})
