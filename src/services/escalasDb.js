const sql = require('../db/database')
const { v4: uuid } = require('uuid')

function buscarTrocasPorEscalaIds() {
  try {
    return sql.all(
      `
      SELECT t.*,
        ua.nome AS anterior_nome,
        un.nome AS novo_nome,
        ur.nome AS registrado_por_nome
      FROM escala_trocas t
      JOIN usuarios ua ON ua.id = t.usuario_anterior_id
      JOIN usuarios un ON un.id = t.usuario_novo_id
      LEFT JOIN usuarios ur ON ur.id = t.registrado_por
      ORDER BY t.registrado_em ASC
    `
    )
  } catch {
    return []
  }
}

function mapTrocaRow(t) {
  return {
    id: t.id,
    usuario_anterior_id: t.usuario_anterior_id,
    usuario_anterior_nome: t.anterior_nome,
    usuario_novo_id: t.usuario_novo_id,
    usuario_novo_nome: t.novo_nome,
    funcao_mantida: t.funcao_mantida || '',
    registrado_em: t.registrado_em,
    registrado_por: t.registrado_por || null,
    registrado_por_nome: t.registrado_por_nome || null,
    observacao: t.observacao || ''
  }
}

function buscarEscalasComVoluntarios() {
  const rows = sql.all(
    `SELECT e.*, d.nome as departamento_nome, d.icone as departamento_icone
     FROM escalas e
     LEFT JOIN departamentos d ON d.id = e.departamento_id
     ORDER BY e.criado_em DESC`
  )
  const volRows = sql.all(
    `
    SELECT ev.escala_id, ev.usuario_id, ev.funcao, u.nome as usuario_nome
    FROM escala_voluntarios ev
    JOIN usuarios u ON u.id = ev.usuario_id
  `
  )
  const trocasRows = buscarTrocasPorEscalaIds()
  return rows.map((e) => ({
    id: e.id,
    data: e.data,
    departamento_id: e.departamento_id,
    departamento_nome: e.departamento_nome || '',
    departamento_icone: e.departamento_icone || '',
    evento_id: e.evento_id || null,
    observacao: e.observacao || '',
    criado_por: e.criado_por,
    criado_em: e.criado_em,
    voluntarios: volRows
      .filter((v) => v.escala_id === e.id)
      .map((v) => ({
        usuario_id: v.usuario_id,
        nome: v.usuario_nome,
        funcao: v.funcao || ''
      })),
    trocas: trocasRows.filter((t) => t.escala_id === e.id).map(mapTrocaRow)
  }))
}

/**
 * Troca um integrante por outro na mesma escala e registra o histórico (antes A → agora B).
 */
function trocarVoluntarioNaEscala({
  escalaId,
  usuarioSai,
  usuarioEntra,
  registradoPor,
  observacao,
  permitirOutroDepartamento = false
}) {
  const tx = sql.transaction(() => {
    const escala = sql.get(`SELECT * FROM escalas WHERE id = ?`, escalaId)
    if (!escala) {
      const err = new Error('Escala não encontrada')
      err.code = 'NOT_FOUND'
      throw err
    }
    const depId = escala.departamento_id

    const atual = sql.get(
      `SELECT * FROM escala_voluntarios WHERE escala_id = ? AND usuario_id = ?`,
      escalaId,
      usuarioSai
    )
    if (!atual) {
      const err = new Error('Este integrante não está nesta escala')
      err.code = 'BAD_STATE'
      throw err
    }

    if (usuarioSai === usuarioEntra) {
      const err = new Error('O integrante que entra deve ser diferente do que sai')
      err.code = 'INVALID'
      throw err
    }

    if (!permitirOutroDepartamento) {
      const okEntra = sql.get(
        `SELECT 1 FROM usuario_departamento WHERE usuario_id = ? AND departamento_id = ?`,
        usuarioEntra,
        depId
      )
      if (!okEntra) {
        const err = new Error('O novo integrante precisa pertencer ao mesmo departamento da escala')
        err.code = 'INVALID'
        throw err
      }
    } else {
      const existeUsuario = sql.get(`SELECT id FROM usuarios WHERE id = ? AND ativo = 1`, usuarioEntra)
      if (!existeUsuario) {
        const err = new Error('Usuário que entra não encontrado ou inativo')
        err.code = 'INVALID'
        throw err
      }
    }

    const ja = sql.get(
      `SELECT 1 FROM escala_voluntarios WHERE escala_id = ? AND usuario_id = ?`,
      escalaId,
      usuarioEntra
    )
    if (ja) {
      const err = new Error('O novo integrante já está nesta escala')
      err.code = 'INVALID'
      throw err
    }

    sql.run(`DELETE FROM escala_voluntarios WHERE id = ?`, atual.id)

    sql.run(
      `INSERT INTO escala_voluntarios (id, escala_id, usuario_id, funcao) VALUES (?,?,?,?)`,
      uuid(),
      escalaId,
      usuarioEntra,
      atual.funcao || ''
    )

    sql.run(
      `INSERT INTO escala_trocas (id, escala_id, usuario_anterior_id, usuario_novo_id, funcao_mantida, registrado_em, registrado_por, observacao) VALUES (?,?,?,?,?,?,?,?)`,
      uuid(),
      escalaId,
      usuarioSai,
      usuarioEntra,
      atual.funcao || '',
      new Date().toISOString(),
      registradoPor || null,
      observacao || ''
    )
  })

  tx()
}

function inserirVoluntariosNaEscala(escalaId, departamentoId, voluntarios) {
  const lista = Array.isArray(voluntarios) ? voluntarios : []
  for (const item of lista) {
    const usuario_id = typeof item === 'string' ? item : item?.usuario_id
    if (!usuario_id) continue
    const ok = sql.get(
      `SELECT 1 FROM usuario_departamento WHERE usuario_id = ? AND departamento_id = ?`,
      usuario_id,
      departamentoId
    )
    if (!ok) continue
    const funcao = typeof item === 'object' && item.funcao ? String(item.funcao) : ''
    try {
      sql.run(
        `INSERT INTO escala_voluntarios (id, escala_id, usuario_id, funcao) VALUES (?,?,?,?)`,
        uuid(),
        escalaId,
        usuario_id,
        funcao
      )
    } catch {
      /* duplicata escala+usuário */
    }
  }
}

/**
 * @param {object} opts
 * @param {string} opts.data — DD/MM/AAAA
 * @param {string} opts.departamento_id
 * @param {string|null} [opts.evento_id]
 * @param {string} [opts.observacao]
 * @param {string|null} [opts.criado_por] — id usuário ou null (ex.: agente)
 * @param {Array<string|{usuario_id:string,funcao?:string}>} [opts.voluntarios]
 * @returns {string} id da escala
 */
function criarEscalaNoBanco(opts) {
  const {
    data,
    departamento_id,
    evento_id = null,
    observacao = '',
    criado_por = null,
    voluntarios = []
  } = opts

  const id = uuid()
  const agora = new Date().toISOString()
  sql.run(
    `INSERT INTO escalas (id, data, departamento_id, observacao, criado_por, criado_em, evento_id) VALUES (?,?,?,?,?,?,?)`,
    id,
    data,
    departamento_id,
    observacao,
    criado_por,
    agora,
    evento_id || null
  )
  inserirVoluntariosNaEscala(id, departamento_id, voluntarios)
  return id
}

function atualizarEscalaNoBanco(escalaId, { data, evento_id, observacao, voluntarios }) {
  const e = sql.get(`SELECT id, departamento_id FROM escalas WHERE id = ?`, escalaId)
  if (!e) {
    const err = new Error('Escala não encontrada')
    err.code = 'NOT_FOUND'
    throw err
  }
  if (data !== undefined) sql.run(`UPDATE escalas SET data = ? WHERE id = ?`, data, escalaId)
  if (evento_id !== undefined)
    sql.run(`UPDATE escalas SET evento_id = ? WHERE id = ?`, evento_id || null, escalaId)
  if (observacao !== undefined)
    sql.run(`UPDATE escalas SET observacao = ? WHERE id = ?`, observacao, escalaId)
  if (voluntarios !== undefined) {
    sql.run(`DELETE FROM escala_voluntarios WHERE escala_id = ?`, escalaId)
    inserirVoluntariosNaEscala(escalaId, e.departamento_id, voluntarios)
  }
}

module.exports = {
  buscarEscalasComVoluntarios,
  criarEscalaNoBanco,
  inserirVoluntariosNaEscala,
  trocarVoluntarioNaEscala,
  atualizarEscalaNoBanco
}
