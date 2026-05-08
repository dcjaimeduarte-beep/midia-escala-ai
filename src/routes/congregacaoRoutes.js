const express = require('express')
const router  = express.Router()
const { v4: uuid } = require('uuid')
const db = require('../db/database')
const { autenticar, apenasAdmin } = require('../auth/middleware')

// GET /congregacao — lista todas (admin) ou só a própria
router.get('/', autenticar, (req, res) => {
  if (req.usuario.role === 'admin') {
    const rows = db.all(`
      SELECT c.*, COUNT(u.id) as total_membros
      FROM congregacoes c
      LEFT JOIN usuarios u ON u.congregacao_id = c.id AND u.ativo = 1
      GROUP BY c.id
      ORDER BY c.tipo DESC, c.nome
    `)
    return res.json(rows.map(r => ({ ...r, ativo: !!r.ativo })))
  }
  // Membro comum: retorna apenas a própria congregação
  const cong = db.get(`SELECT * FROM congregacoes WHERE id = ?`, req.usuario.congregacao_id)
  res.json(cong ? [{ ...cong, ativo: !!cong.ativo }] : [])
})

// GET /congregacao/:id
router.get('/:id', autenticar, apenasAdmin, (req, res) => {
  const cong = db.get(`SELECT * FROM congregacoes WHERE id = ?`, req.params.id)
  if (!cong) return res.status(404).json({ erro: 'Congregação não encontrada' })
  res.json({ ...cong, ativo: !!cong.ativo })
})

// POST /congregacao — admin cria nova
router.post('/', autenticar, apenasAdmin, (req, res) => {
  const { nome, tipo, cidade, endereco } = req.body
  if (!nome) return res.status(400).json({ erro: 'nome é obrigatório' })
  const tipoVal = tipo === 'sede' ? 'sede' : 'subcongregacao'
  if (tipoVal === 'sede') {
    const jaTem = db.get(`SELECT id FROM congregacoes WHERE tipo = 'sede'`)
    if (jaTem) return res.status(400).json({ erro: 'Já existe uma congregação sede' })
  }
  const id = uuid()
  db.run(`INSERT INTO congregacoes (id,nome,tipo,cidade,endereco,ativo,criado_em) VALUES (?,?,?,?,?,1,?)`,
    id, nome.trim(), tipoVal, cidade?.trim() || '', endereco?.trim() || '', new Date().toISOString())
  res.status(201).json(db.get(`SELECT * FROM congregacoes WHERE id = ?`, id))
})

// PUT /congregacao/:id — admin edita
router.put('/:id', autenticar, apenasAdmin, (req, res) => {
  const cong = db.get(`SELECT * FROM congregacoes WHERE id = ?`, req.params.id)
  if (!cong) return res.status(404).json({ erro: 'Congregação não encontrada' })
  const { nome, tipo, cidade, endereco, ativo } = req.body
  if (nome)    db.run(`UPDATE congregacoes SET nome     = ? WHERE id = ?`, nome.trim(), req.params.id)
  if (cidade !== undefined) db.run(`UPDATE congregacoes SET cidade   = ? WHERE id = ?`, cidade.trim(), req.params.id)
  if (endereco !== undefined) db.run(`UPDATE congregacoes SET endereco = ? WHERE id = ?`, endereco.trim(), req.params.id)
  if (ativo !== undefined) db.run(`UPDATE congregacoes SET ativo    = ? WHERE id = ?`, ativo ? 1 : 0, req.params.id)
  if (tipo && ['sede','subcongregacao'].includes(tipo) && tipo !== cong.tipo) {
    if (tipo === 'sede') {
      const jaTem = db.get(`SELECT id FROM congregacoes WHERE tipo = 'sede' AND id != ?`, req.params.id)
      if (jaTem) return res.status(400).json({ erro: 'Já existe uma congregação sede' })
    }
    db.run(`UPDATE congregacoes SET tipo = ? WHERE id = ?`, tipo, req.params.id)
  }
  res.json({ ...db.get(`SELECT * FROM congregacoes WHERE id = ?`, req.params.id), ativo: !!ativo })
})

// DELETE /congregacao/:id — admin, só se não tiver membros
router.delete('/:id', autenticar, apenasAdmin, (req, res) => {
  const cong = db.get(`SELECT * FROM congregacoes WHERE id = ?`, req.params.id)
  if (!cong) return res.status(404).json({ erro: 'Congregação não encontrada' })
  if (cong.tipo === 'sede') return res.status(400).json({ erro: 'A congregação sede não pode ser excluída' })
  const uso = db.get(`SELECT id FROM usuarios WHERE congregacao_id = ? LIMIT 1`, req.params.id)
  if (uso) return res.status(400).json({ erro: 'Congregação possui membros. Transfira-os antes de excluir.' })
  db.run(`DELETE FROM congregacoes WHERE id = ?`, req.params.id)
  res.json({ ok: true })
})

module.exports = router
