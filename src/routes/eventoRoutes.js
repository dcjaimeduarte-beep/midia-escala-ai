const express = require('express')
const router = express.Router()
const { v4: uuid } = require('uuid')
const sql = require('../db/database')
const { syncEventosParaMemoria } = require('../db/bootstrap')
const { autenticar, apenasAdminOuLider } = require('../auth/middleware')

/** 0 = domingo … 6 = sábado; null = evento pontual / sem dia fixo */
router.get('/listar', autenticar, (req, res) => {
  const todos = req.query.todos === '1' && req.usuario.role === 'admin'
  const rows = todos
    ? sql.all(`SELECT * FROM eventos ORDER BY dia_semana, hora_inicio, nome`)
    : sql.all(`SELECT * FROM eventos WHERE ativo = 1 ORDER BY dia_semana, hora_inicio, nome`)

  res.json(
    rows.map((r) => ({
      ...r,
      ativo: !!r.ativo
    }))
  )
})

router.post('/criar', autenticar, apenasAdminOuLider, (req, res) => {
  const { nome, dia_semana, hora_inicio, hora_fim, descricao } = req.body
  if (!nome) return res.status(400).json({ erro: 'nome é obrigatório' })

  const id = uuid()
  const agora = new Date().toISOString()
  const dia =
    dia_semana === '' || dia_semana === undefined || dia_semana === null
      ? null
      : Number(dia_semana)

  sql.run(
    `INSERT INTO eventos (id, nome, dia_semana, hora_inicio, hora_fim, descricao, ativo, criado_em) VALUES (?,?,?,?,?,?,1,?)`,
    id,
    nome,
    Number.isFinite(dia) ? dia : null,
    hora_inicio || '',
    hora_fim || '',
    descricao || '',
    agora
  )
  syncEventosParaMemoria()
  const ev = sql.get(`SELECT * FROM eventos WHERE id = ?`, id)
  res.status(201).json({ ...ev, ativo: !!ev.ativo })
})

router.put('/:id', autenticar, apenasAdminOuLider, (req, res) => {
  const ev = sql.get(`SELECT * FROM eventos WHERE id = ?`, req.params.id)
  if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' })

  const { nome, dia_semana, hora_inicio, hora_fim, descricao, ativo } = req.body
  if (nome !== undefined) sql.run(`UPDATE eventos SET nome = ? WHERE id = ?`, nome, req.params.id)
  if (dia_semana !== undefined) {
    const dia =
      dia_semana === '' || dia_semana === null ? null : Number(dia_semana)
    sql.run(
      `UPDATE eventos SET dia_semana = ? WHERE id = ?`,
      Number.isFinite(dia) ? dia : null,
      req.params.id
    )
  }
  if (hora_inicio !== undefined)
    sql.run(`UPDATE eventos SET hora_inicio = ? WHERE id = ?`, hora_inicio, req.params.id)
  if (hora_fim !== undefined) sql.run(`UPDATE eventos SET hora_fim = ? WHERE id = ?`, hora_fim, req.params.id)
  if (descricao !== undefined)
    sql.run(`UPDATE eventos SET descricao = ? WHERE id = ?`, descricao, req.params.id)
  if (ativo !== undefined) sql.run(`UPDATE eventos SET ativo = ? WHERE id = ?`, ativo ? 1 : 0, req.params.id)

  syncEventosParaMemoria()
  const atual = sql.get(`SELECT * FROM eventos WHERE id = ?`, req.params.id)
  res.json({ ...atual, ativo: !!atual.ativo })
})

router.delete('/:id', autenticar, apenasAdminOuLider, (req, res) => {
  const ev = sql.get(`SELECT * FROM eventos WHERE id = ?`, req.params.id)
  if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' })

  // Limpa referência opcional em escalas antes de remover o evento.
  sql.run(`UPDATE escalas SET evento_id = NULL WHERE evento_id = ?`, req.params.id)
  sql.run(`DELETE FROM eventos WHERE id = ?`, req.params.id)

  syncEventosParaMemoria()
  res.json({ ok: true })
})

module.exports = router
