const Database = require('better-sqlite3')
const path     = require('path')

const db = new Database(path.join(__dirname, '..', '..', 'peniel.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

module.exports = {
  get:         (sql, ...p) => db.prepare(sql).get(...p),
  all:         (sql, ...p) => db.prepare(sql).all(...p),
  run:         (sql, ...p) => db.prepare(sql).run(...p),
  exec:        sql          => db.exec(sql),
  transaction: fn           => db.transaction(fn),
  _db:         db
}
