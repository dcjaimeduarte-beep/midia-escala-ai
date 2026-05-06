/**
 * Destinatários de notificações para um comunicado — mesma visibilidade que no app.
 * - Geral (sem departamento): todos os utilizadores ativos (exceto autor).
 * - Por departamento: quem tem vínculo ou `acesso_departamentos` a esse departamento + admins.
 */
const sql = require('../db/database')

/** Utilizadores com vínculo principal ou lista JSON `acesso_departamentos` ao departamento. */
function usuarioIdsComAcessoADepartamento(departamentoId) {
  const target = String(departamentoId || '').trim()
  if (!target) return new Set()
  const rows = sql.all(
    `SELECT usuario_id, departamento_id, acesso_departamentos FROM usuario_departamento`
  )
  const ids = new Set()
  for (const r of rows) {
    if (String(r.departamento_id || '').trim() === target) {
      ids.add(r.usuario_id)
      continue
    }
    try {
      const extra = JSON.parse(r.acesso_departamentos || '[]')
      if (Array.isArray(extra) && extra.some((x) => String(x).trim() === target)) {
        ids.add(r.usuario_id)
      }
    } catch (_) {}
  }
  return ids
}

/** Lista base (e-mail e celular podem estar vazios por utilizador). */
function listarDestinatariosAviso(departamentoId, excluirUsuarioId) {
  const excl = excluirUsuarioId || ''
  const di = departamentoId != null ? String(departamentoId).trim() : ''
  if (!di) {
    return sql.all(
      `
    SELECT id, nome, email, celular FROM usuarios u
    WHERE u.ativo = 1 AND u.id != ?
    `,
      excl
    )
  }

  const comDep = usuarioIdsComAcessoADepartamento(di)
  const idsList = [...comDep].filter((id) => id && id !== excl)
  if (!idsList.length) {
    return sql.all(
      `
      SELECT DISTINCT u.id, u.nome, u.email, u.celular
      FROM usuarios u
      WHERE u.ativo = 1 AND u.id != ? AND u.role = 'admin'
      `,
      excl
    )
  }

  const ph = idsList.map(() => '?').join(',')
  return sql.all(
    `
    SELECT DISTINCT u.id, u.nome, u.email, u.celular
    FROM usuarios u
    WHERE u.ativo = 1
      AND u.id != ?
      AND (u.id IN (${ph}) OR u.role = 'admin')
    `,
    excl,
    ...idsList
  )
}

/** Só quem tem e-mail (envio SMTP). */
function listarDestinatariosEmailAviso(departamentoId, excluirUsuarioId) {
  return listarDestinatariosAviso(departamentoId, excluirUsuarioId).filter(
    (u) => u.email && String(u.email).trim()
  )
}

module.exports = {
  listarDestinatariosAviso,
  listarDestinatariosEmailAviso
}
