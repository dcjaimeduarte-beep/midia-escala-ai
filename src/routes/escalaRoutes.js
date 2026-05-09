const express = require('express')
const router = express.Router()
const { v4: uuid } = require('uuid')
const eventBus = require('../events/eventBus')
const sql = require('../db/database')
const { autenticar, verificarAcessoDepartamento } = require('../auth/middleware')
const { syncEscalasParaMemoria } = require('../db/bootstrap')
const {
  criarEscalaNoBanco,
  buscarEscalasComVoluntarios,
  trocarVoluntarioNaEscala,
  atualizarEscalaNoBanco
} = require('../services/escalasDb')

function escalaPorId(id) {
  return buscarEscalasComVoluntarios().find((e) => e.id === id) || null
}

function upsertAvisoEscala(escala, autorId) {
  if (!escala || !escala.departamento_id) return
  const depto = sql.get(`SELECT nome FROM departamentos WHERE id = ?`, escala.departamento_id)
  const evento = escala.evento_id
    ? sql.get(`SELECT nome, hora_inicio, hora_fim FROM eventos WHERE id = ?`, escala.evento_id)
    : null
  const nomeEvento = evento
    ? `${evento.nome}${evento.hora_inicio ? ` (${evento.hora_inicio}${evento.hora_fim ? '–' + evento.hora_fim : ''})` : ''}`
    : ''
  const vols = Array.isArray(escala.voluntarios) ? escala.voluntarios : []
  const listaVols = vols.length
    ? vols.map((v) => `• ${v.nome}${v.funcao ? ` · ${v.funcao}` : ''}`).join('\n')
    : 'Nenhum integrante designado ainda.'
  const titulo = `📅 Escala — ${escala.data}`
  const corpo = [
    `Data: *${escala.data}*${nomeEvento ? `  |  ${nomeEvento}` : ''}`,
    `Departamento: ${depto?.nome || '—'}`,
    '',
    'Integrantes escalados:',
    listaVols
  ].join('\n')
  const partes = String(escala.data || '').split('/')
  const dataISO = partes.length === 3 ? `${partes[2]}-${partes[1]}-${partes[0]}` : ''
  const agora = new Date().toISOString()
  // Substitui aviso anterior da mesma escala (mesmo título + departamento) para não duplicar
  sql.run(
    `DELETE FROM avisos WHERE titulo = ? AND departamento_id = ?`,
    titulo,
    escala.departamento_id
  )
  sql.run(
    `INSERT INTO avisos (id, titulo, corpo, departamento_id, autor_id, criado_em, data_inicio, hora_inicio, data_fim, hora_fim)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    uuid(), titulo, corpo, escala.departamento_id, autorId, agora, dataISO, '', dataISO, ''
  )
}

function podeGerirEscalaDepartamento(req, departamentoId) {
  if (req.usuario.role === 'admin' || req.usuario.role === 'lider') return true
  if (req.usuario.acesso_escala_global) return true
  const v = sql.get(
    `SELECT role_depto FROM usuario_departamento WHERE usuario_id = ? AND departamento_id = ?`,
    req.usuario.id,
    departamentoId
  )
  return v?.role_depto === 'lider'
}

// POST /escala/criar
router.post('/criar', autenticar, verificarAcessoDepartamento, (req, res) => {
  const { data, departamento_id, evento_id, observacao, voluntarios } = req.body
  if (!data || !departamento_id)
    return res.status(400).json({ erro: 'data e departamento_id são obrigatórios' })
  if (!podeGerirEscalaDepartamento(req, departamento_id)) {
    return res.status(403).json({
      erro: 'Apenas administrador ou líder do departamento pode criar escala'
    })
  }

  const depto = sql.get(`SELECT id FROM departamentos WHERE id = ? AND ativo = 1`, departamento_id)
  if (!depto) return res.status(404).json({ erro: 'Departamento não encontrado' })

  try {
    const id = criarEscalaNoBanco({
      data,
      departamento_id,
      evento_id: evento_id || null,
      observacao: observacao || '',
      criado_por: req.usuario.id,
      congregacao_id: req.usuario.congregacao_id || null,
      voluntarios: voluntarios || []
    })
    syncEscalasParaMemoria()
    const escala = escalaPorId(id)
    eventBus.emit('escala_criada', escala)
    try { upsertAvisoEscala(escala, req.usuario.id) } catch (e) { console.error('[aviso/escala]', e) }
    res.status(201).json(escala)
  } catch (e) {
    console.error('[escala/criar]', e)
    res.status(500).json({ erro: 'Não foi possível criar a escala' })
  }
})

// POST /escala/:escalaId/solicitar-troca — membro solicita; líder/admin aprova depois
router.post('/:escalaId/solicitar-troca', autenticar, (req, res) => {
  const { usuario_sai, usuario_entra, observacao } = req.body
  const escalaId = req.params.escalaId
  if (!usuario_sai || !usuario_entra)
    return res.status(400).json({ erro: 'usuario_sai e usuario_entra são obrigatórios' })

  const escala = sql.get(`SELECT id, departamento_id FROM escalas WHERE id = ?`, escalaId)
  if (!escala) return res.status(404).json({ erro: 'Escala não encontrada' })

  const estaNaEscala = sql.get(
    `SELECT 1 FROM escala_voluntarios WHERE escala_id = ? AND usuario_id = ?`,
    escalaId,
    usuario_sai
  )
  if (!estaNaEscala) return res.status(400).json({ erro: 'O usuário de saída não está nesta escala' })

  if (req.usuario.role === 'membro' && req.usuario.id !== usuario_sai) {
    return res.status(403).json({ erro: 'Membro só pode solicitar troca para a própria escala' })
  }

  const entraAtivo = sql.get(`SELECT id FROM usuarios WHERE id = ? AND ativo = 1`, usuario_entra)
  if (!entraAtivo) return res.status(404).json({ erro: 'Usuário que entra não encontrado ou inativo' })

  const id = uuid()
  const agora = new Date().toISOString()
  sql.run(
    `INSERT INTO troca_solicitacoes (id, escala_id, departamento_id, usuario_sai, usuario_entra, solicitante_id, observacao, status, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id,
    escalaId,
    escala.departamento_id,
    usuario_sai,
    usuario_entra,
    req.usuario.id,
    observacao || '',
    'pendente',
    agora
  )

  const dep = sql.get(`SELECT nome FROM departamentos WHERE id = ?`, escala.departamento_id)
  eventBus.emit('notificacao_equipe', {
    tipo: 'troca_pendente',
    mensagem: `Nova solicitação de troca pendente no departamento ${dep?.nome || '—'}.`
  })
  res.status(201).json({ ok: true, id })
})

// GET /escala/trocas/pendentes — admin vê tudo; demais só onde é líder de departamento
router.get('/trocas/pendentes', autenticar, (req, res) => {
  let rows = sql.all(
    `SELECT ts.*, d.nome as departamento_nome, us.nome as solicitante_nome, ua.nome as sai_nome, ue.nome as entra_nome
     FROM troca_solicitacoes ts
     LEFT JOIN departamentos d ON d.id = ts.departamento_id
     LEFT JOIN usuarios us ON us.id = ts.solicitante_id
     LEFT JOIN usuarios ua ON ua.id = ts.usuario_sai
     LEFT JOIN usuarios ue ON ue.id = ts.usuario_entra
     WHERE ts.status = 'pendente'
     ORDER BY ts.criado_em DESC`
  )
  if (req.usuario.role !== 'admin') {
    const depLider = sql
      .all(
        `SELECT departamento_id FROM usuario_departamento WHERE usuario_id = ? AND role_depto = 'lider'`,
        req.usuario.id
      )
      .map((r) => r.departamento_id)
    if (!depLider.length) return res.json([])
    rows = rows.filter((r) => depLider.includes(r.departamento_id))
  }
  res.json(rows)
})

// GET /escala/trocas/listar — visível para todos; aprovação só liderança/admin
router.get('/trocas/listar', autenticar, (req, res) => {
  const rows = sql.all(
    `SELECT ts.*, d.nome as departamento_nome, us.nome as solicitante_nome, ua.nome as sai_nome, ue.nome as entra_nome
     FROM troca_solicitacoes ts
     LEFT JOIN departamentos d ON d.id = ts.departamento_id
     LEFT JOIN usuarios us ON us.id = ts.solicitante_id
     LEFT JOIN usuarios ua ON ua.id = ts.usuario_sai
     LEFT JOIN usuarios ue ON ue.id = ts.usuario_entra
     WHERE ts.status = 'pendente'
     ORDER BY ts.criado_em DESC`
  )
  const lista = rows.map((r) => ({
    ...r,
    pode_aprovar:
      req.usuario.role === 'admin' || !!sql.get(
        `SELECT 1 FROM usuario_departamento WHERE usuario_id = ? AND departamento_id = ? AND role_depto = 'lider'`,
        req.usuario.id,
        r.departamento_id
      )
  }))
  res.json(lista)
})

// POST /escala/trocas/:id/aprovar — admin ou líder do departamento da solicitação
router.post('/trocas/:id/aprovar', autenticar, (req, res) => {
  const row = sql.get(`SELECT * FROM troca_solicitacoes WHERE id = ?`, req.params.id)
  if (!row) return res.status(404).json({ erro: 'Solicitação não encontrada' })
  if (row.status !== 'pendente') return res.status(400).json({ erro: 'Solicitação já resolvida' })
  if (req.usuario.role !== 'admin' && !podeGerirEscalaDepartamento(req, row.departamento_id)) {
    return res.status(403).json({ erro: 'Sem permissão para aprovar esta solicitação' })
  }
  try {
    trocarVoluntarioNaEscala({
      escalaId: row.escala_id,
      usuarioSai: row.usuario_sai,
      usuarioEntra: row.usuario_entra,
      registradoPor: req.usuario.id,
      observacao: row.observacao || '',
      permitirOutroDepartamento: true
    })
    sql.run(
      `UPDATE troca_solicitacoes SET status='aprovada', aprovado_por=?, resolvido_em=? WHERE id=?`,
      req.usuario.id,
      new Date().toISOString(),
      row.id
    )
    syncEscalasParaMemoria()
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não foi possível aprovar troca' })
  }
})

// POST /escala/trocas/:id/rejeitar — admin ou líder do departamento da solicitação
router.post('/trocas/:id/rejeitar', autenticar, (req, res) => {
  const row = sql.get(`SELECT * FROM troca_solicitacoes WHERE id = ?`, req.params.id)
  if (!row) return res.status(404).json({ erro: 'Solicitação não encontrada' })
  if (row.status !== 'pendente') return res.status(400).json({ erro: 'Solicitação já resolvida' })
  if (req.usuario.role !== 'admin' && !podeGerirEscalaDepartamento(req, row.departamento_id)) {
    return res.status(403).json({ erro: 'Sem permissão para rejeitar esta solicitação' })
  }
  sql.run(
    `UPDATE troca_solicitacoes SET status='rejeitada', aprovado_por=?, resolvido_em=? WHERE id=?`,
    req.usuario.id,
    new Date().toISOString(),
    row.id
  )
  res.json({ ok: true })
})

// DELETE /escala/trocas/:id — remove solicitação pendente (admin ou líder do departamento)
router.delete('/trocas/:id', autenticar, (req, res) => {
  const row = sql.get(`SELECT * FROM troca_solicitacoes WHERE id = ?`, req.params.id)
  if (!row) return res.status(404).json({ erro: 'Solicitação não encontrada' })
  if (row.status !== 'pendente') {
    return res.status(400).json({ erro: 'Só é possível excluir solicitação pendente' })
  }
  if (req.usuario.role !== 'admin' && !podeGerirEscalaDepartamento(req, row.departamento_id)) {
    return res.status(403).json({ erro: 'Sem permissão para excluir esta solicitação' })
  }
  sql.run(`DELETE FROM troca_solicitacoes WHERE id = ?`, row.id)
  res.json({ ok: true })
})

// DELETE /escala/trocas/historico/:id — remove item do histórico de trocas (admin ou líder do setor)
router.delete('/trocas/historico/:id', autenticar, (req, res) => {
  const row = sql.get(
    `SELECT et.id, et.escala_id, e.departamento_id
     FROM escala_trocas et
     JOIN escalas e ON e.id = et.escala_id
     WHERE et.id = ?`,
    req.params.id
  )
  if (!row) return res.status(404).json({ erro: 'Troca de histórico não encontrada' })
  if (req.usuario.role !== 'admin' && !podeGerirEscalaDepartamento(req, row.departamento_id)) {
    return res.status(403).json({ erro: 'Sem permissão para excluir este histórico de troca' })
  }
  sql.run(`DELETE FROM escala_trocas WHERE id = ?`, row.id)
  syncEscalasParaMemoria()
  res.json({ ok: true })
})

// GET /escala/minhas/:usuario_id
router.get('/minhas/:usuario_id', autenticar, (req, res) => {
  const { usuario_id } = req.params

  if (req.usuario.role !== 'admin' && req.usuario.id !== usuario_id)
    return res.status(403).json({ erro: 'Sem permissão' })

  const deps = sql
    .all(`SELECT departamento_id FROM usuario_departamento WHERE usuario_id = ?`, usuario_id)
    .map((r) => r.departamento_id)

  const todas = buscarEscalasComVoluntarios()
  const filtradas = todas.filter(
    (e) =>
      deps.includes(e.departamento_id) ||
      (e.voluntarios || []).some((v) => v.usuario_id === usuario_id)
  )

  res.json(filtradas)
})

// GET /escala/departamento/:departamento_id
router.get('/departamento/:departamento_id', autenticar, verificarAcessoDepartamento, (req, res) => {
  const id = req.params.departamento_id
  const lista = buscarEscalasComVoluntarios().filter((e) => e.departamento_id === id)
  res.json(lista)
})

// GET /escala/listar — admin vê tudo
router.get('/listar', autenticar, (req, res) => {
  if (req.usuario.role !== 'admin')
    return res.status(403).json({ erro: 'Acesso restrito a administradores' })
  res.json(buscarEscalasComVoluntarios())
})

// GET /escala/visao-geral — qualquer usuário autenticado vê o quadro completo
router.get('/visao-geral', autenticar, (req, res) => {
  res.json(buscarEscalasComVoluntarios())
})

// PUT /escala/:escalaId — data (DD/MM/AAAA), evento_id, observacao e voluntarios; admin ou líder do dept
router.put('/:escalaId', autenticar, (req, res) => {
  const escalaRow = sql.get(`SELECT id, departamento_id FROM escalas WHERE id = ?`, req.params.escalaId)
  if (!escalaRow) return res.status(404).json({ erro: 'Escala não encontrada' })
  if (!podeGerirEscalaDepartamento(req, escalaRow.departamento_id)) {
    return res.status(403).json({
      erro: 'Apenas administrador ou líder do departamento pode alterar esta escala'
    })
  }
  const { data, evento_id, observacao, voluntarios } = req.body
  if (
    data === undefined &&
    evento_id === undefined &&
    observacao === undefined &&
    voluntarios === undefined
  ) {
    return res
      .status(400)
      .json({ erro: 'Informe ao menos um campo: data, evento_id, observacao ou voluntarios' })
  }
  try {
    atualizarEscalaNoBanco(req.params.escalaId, { data, evento_id, observacao, voluntarios })
    syncEscalasParaMemoria()
    const escalaAtualizada = escalaPorId(req.params.escalaId)
    if (voluntarios !== undefined) {
      try { upsertAvisoEscala(escalaAtualizada, req.usuario.id) } catch (e) { console.error('[aviso/escala]', e) }
    }
    res.json(escalaAtualizada)
  } catch (e) {
    const status = e.code === 'NOT_FOUND' ? 404 : 500
    res.status(status).json({ erro: e.message || 'Erro ao atualizar escala' })
  }
})

// DELETE /escala/:escalaId — admin ou líder do dept
router.delete('/:escalaId', autenticar, (req, res) => {
  const escalaRow = sql.get(`SELECT id, departamento_id FROM escalas WHERE id = ?`, req.params.escalaId)
  if (!escalaRow) return res.status(404).json({ erro: 'Escala não encontrada' })
  if (!podeGerirEscalaDepartamento(req, escalaRow.departamento_id)) {
    return res.status(403).json({
      erro: 'Apenas administrador ou líder do departamento pode excluir esta escala'
    })
  }

  sql.run(`DELETE FROM escalas WHERE id = ?`, req.params.escalaId)
  syncEscalasParaMemoria()
  res.json({ ok: true })
})

// POST /escala/:escalaId/trocar-voluntario — admin ou líder do dept; registra histórico A → B
router.post('/:escalaId/trocar-voluntario', autenticar, (req, res) => {
  return res.status(410).json({
    erro:
      'Troca direta desativada. Use /solicitar-troca para registrar solicitação pendente e aguardar aprovação da liderança.'
  })
})

module.exports = router
