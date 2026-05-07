const Database = require('better-sqlite3')
const path     = require('path')
const fs       = require('fs')

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', '..', 'peniel.db')

if (process.env.DB_PATH) {
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

const db = new Database(dbPath)
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
