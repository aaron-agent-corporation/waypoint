import { describe, expect, it } from 'vitest'

import { splitSqlStatements } from './split-sql.ts'

describe('splitSqlStatements', () => {
  it('splits ordinary statements and drops the empties', () => {
    expect(splitSqlStatements('CREATE SCHEMA a;\n\nCREATE TABLE a.b (id text);\n')).toEqual([
      'CREATE SCHEMA a',
      'CREATE TABLE a.b (id text)',
    ])
  })

  it('keeps a semicolon inside a string literal', () => {
    // The real DDL raises: 'an approved packet version is immutable; change
    // requires a successor version'. Split naively, that trigger body becomes
    // two fragments that both fail.
    const sql = "SELECT 'immutable; use a successor';\nSELECT 2;"
    expect(splitSqlStatements(sql)).toEqual(["SELECT 'immutable; use a successor'", 'SELECT 2'])
  })

  it('handles a doubled quote inside a literal', () => {
    expect(splitSqlStatements("SELECT 'it''s; fine';\nSELECT 2;")).toEqual([
      "SELECT 'it''s; fine'",
      'SELECT 2',
    ])
  })

  it('keeps a semicolon inside a line comment', () => {
    const sql = 'CREATE TABLE a (\n  -- status is DERIVED; never written\n  id text\n);\nSELECT 2;'
    const statements = splitSqlStatements(sql)
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('DERIVED; never written')
  })

  it('keeps a dollar-quoted body whole, whatever its tag', () => {
    // $fn$ and $guard$ are both used by the project DDL. A trigger function
    // is several semicolon-terminated lines inside one statement.
    const sql = [
      'CREATE FUNCTION f() RETURNS trigger AS $fn$',
      'BEGIN',
      '  PERFORM 1;',
      '  RETURN NEW;',
      'END',
      '$fn$ LANGUAGE plpgsql;',
      'SELECT 2;',
    ].join('\n')
    const statements = splitSqlStatements(sql)
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('RETURN NEW;')
    expect(statements[1]).toBe('SELECT 2')
  })

  it('does not confuse two differently tagged blocks', () => {
    const sql = 'DO $guard$ BEGIN PERFORM 1; END $guard$;\nDO $fn$ BEGIN PERFORM 2; END $fn$;'
    expect(splitSqlStatements(sql)).toHaveLength(2)
  })

  it('returns a trailing statement with no terminator', () => {
    expect(splitSqlStatements('SELECT 1')).toEqual(['SELECT 1'])
  })

  it('returns nothing for whitespace or comments alone', () => {
    expect(splitSqlStatements('\n  \n-- nothing here\n')).toEqual([])
  })
})
