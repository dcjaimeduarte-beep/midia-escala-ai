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

function podeGerirEscalaDepartamento(req, departamentoId) {
  if (req.usuario.role === 'admin') return true
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
      voluntarios: voluntarios || []
    })
    syncEscalasParaMemoria()
    const escala = escalaPorId(id)
    eventBus.emit('escala_criada', escala)
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

// PUT /escala/:escalaId — data (DD/MM/AAAA), evento_id, observacao; admin ou líder do dept
router.put('/:escalaId', autenticar, (req, res) => {
  const escalaRow = sql.get(`SELECT id, departamento_id FROM escalas WHERE id = ?`, req.params.escalaId)
  if (!escalaRow) return res.status(404).json({ erro: 'Escala não encontrada' })
  if (!podeGerirEscalaDepartamento(req, escalaRow.departamento_id)) {
    return res.status(403).json({
      erro: 'Apenas administrador ou líder do departamento pode alterar esta escala'
    })
  }
  const { data, evento_id, observacao } = req.body
  if (data === undefined && evento_id === undefined && observacao === undefined) {
    return res.status(400).json({ erro: 'Informe ao menos um campo: data, evento_id ou observacao' })
  }
  try {
    atualizarEscalaNoBanco(req.params.escalaId, { data, evento_id, observacao })
    syncEscalasParaMemoria()
    res.json(escalaPorId(req.params.escalaId))
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
  const { usuario_sai, usuario_entra, observacao } = req.body
  const escalaId = req.params.escalaId
  if (!usuario_sai || !usuario_entra)
    return res.status(400).json({ erro: 'usuario_sai e usuario_entra são obrigatórios' })

  const escalaRow = sql.get(`SELECT id, departamento_id FROM escalas WHERE id = ?`, escalaId)
  if (!escalaRow) return res.status(404).json({ erro: 'Escala não encontrada' })

  if (!podeGerirEscalaDepartamento(req, escalaRow.departamento_id)) {
    return res.status(403).json({
      erro: 'Apenas administrador ou líder do departamento pode registrar trocas nesta escala'
    })
  }

  try {
    trocarVoluntarioNaEscala({
      escalaId,
      usuarioSai: usuario_sai,
      usuarioEntra: usuario_entra,
      registradoPor: req.usuario.id,
      observacao: observacao || ''
    })
    syncEscalasParaMemoria()
    res.json({ ok: true, escala: escalaPorId(escalaId) })
  } catch (e) {
    const status = e.code === 'NOT_FOUND' ? 404 : 400
    res.status(status).json({ erro: e.message || 'Não foi possível registrar a troca' })
  }
})

module.exports = router
