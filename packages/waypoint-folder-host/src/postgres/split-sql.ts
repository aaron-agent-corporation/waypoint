/**
 * Split a DDL script into individual statements.
 *
 * The per-project schema DDL is ~175 statements sent as ONE `pool.query`, and
 * one query is one implicit transaction. A project schema is 182 lockable
 * objects, so that transaction holds 182 locks — and Postgres' lock table is
 * `max_locks_per_transaction x max_connections` slots shared by every backend
 * (6,400 by default). About 35 concurrent schema creates exhaust the whole
 * server with `out of shared memory`, which the test suite does on every run
 * (docs/ERRORS-AND-FIXES.md, 2026-08-22). Issued one at a time, the same DDL
 * holds a handful of locks instead of 182.
 *
 * Splitting SQL on `;` is only safe if you respect what a `;` can sit inside.
 * All three of these appear in the DDL this exists to split:
 *
 *   - line comments — `-- store-level status is DERIVED; not written`
 *   - string literals — `RAISE EXCEPTION 'immutable; use a successor'`
 *   - dollar-quoted bodies with arbitrary tags — `$fn$ ... ; ... $fn$`,
 *     `$guard$ ... $guard$`
 *
 * A naive split corrupts a trigger function into fragments that each fail, so
 * this tracks all three states. Block comments are handled too; they do not
 * occur in the current DDL, but a scanner that silently mis-handles one is
 * worse than one that does not exist.
 */
/** Does this chunk contain anything but comments and whitespace? */
function hasSql(chunk: string): boolean {
  return chunk.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').trim() !== ''
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let start = 0
  let index = 0

  while (index < sql.length) {
    const rest = sql.slice(index)

    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', index)
      index = end === -1 ? sql.length : end + 1
      continue
    }
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', index + 2)
      index = end === -1 ? sql.length : end + 2
      continue
    }
    if (sql[index] === "'") {
      index += 1
      while (index < sql.length) {
        if (sql[index] === "'") {
          // '' is an escaped quote, not the end of the literal.
          if (sql[index + 1] === "'") index += 2
          else { index += 1; break }
        } else index += 1
      }
      continue
    }
    if (sql[index] === '"') {
      index += 1
      while (index < sql.length && sql[index] !== '"') index += 1
      index += 1
      continue
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(rest)
    if (dollar) {
      const tag = dollar[0]
      const end = sql.indexOf(tag, index + tag.length)
      index = end === -1 ? sql.length : end + tag.length
      continue
    }
    if (sql[index] === ';') {
      const statement = sql.slice(start, index).trim()
      if (hasSql(statement)) statements.push(statement)
      index += 1
      start = index
      continue
    }
    index += 1
  }

  const tail = sql.slice(start).trim()
  if (hasSql(tail)) statements.push(tail)
  return statements
}
