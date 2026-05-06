/**
 * Espelho em memória preenchido a partir do SQLite em `src/db/bootstrap.js`.
 * Rotas legadas (escalas, agente) ainda leem estes arrays.
 */
const db = {
  usuarios: [],
  departamentos: [],
  usuario_departamento: [],
  escalas: [],
  /** Tipos de culto/evento recorrentes (dia da semana + horários) */
  eventos: []
}

module.exports = db
