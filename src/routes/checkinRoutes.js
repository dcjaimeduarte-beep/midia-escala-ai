const express = require('express')
const router = express.Router()
const path = require('path')
const { v4: uuid } = require('uuid')
const sql = require('../db/database')

// Serve a página de check-in para qualquer /:id
router.get('/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/checkin.html'))
})

// Info do culto para a página de check-in (sem auth)
router.get('/:id/info', (req, res) => {
  const culto = sql.get(`
    SELECT c.id, c.titulo, c.data, c.descricao, c.encerrado, e.nome AS evento_nome
    FROM cultos c
    LEFT JOIN eventos e ON c.evento_id = e.id
    WHERE c.id = ?
  `, req.params.id)
  if (!culto) return res.status(404).json({ erro: 'Culto não encontrado' })
  res.json({ ...culto, encerrado: !!culto.encerrado })
})

// Lista de membros para autocomplete (sem auth)
router.get('/:id/membros', (req, res) => {
  const membros = sql.all(`SELECT id, nome FROM usuarios WHERE ativo = 1 ORDER BY nome`)
  res.json(membros)
})

// Registrar presença (sem auth)
router.post('/:id', (req, res) => {
  const culto = sql.get(`SELECT id, encerrado FROM cultos WHERE id = ?`, req.params.id)
  if (!culto) return res.status(404).json({ erro: 'Culto não encontrado' })
  if (culto.encerrado) return res.status(400).json({ erro: 'Este culto já foi encerrado' })

  const { nome, tipo, convidado_por, usuario_id, celular, bairro } = req.body
  if (!nome?.trim()) return res.status(400).json({ erro: 'Nome é obrigatório' })
  if (!['membro', 'visitante', 'visitante_convidado'].includes(tipo))
    return res.status(400).json({ erro: 'Tipo inválido' })

  const id    = uuid()
  const agora = new Date().toISOString()
  sql.run(
    `INSERT INTO presencas (id, culto_id, tipo, nome, convidado_por, usuario_id, celular, bairro, registrado_em)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id,
    culto.id,
    tipo,
    nome.trim(),
    convidado_por?.trim() || '',
    usuario_id || null,
    celular?.trim() || '',
    bairro?.trim()  || '',
    agora
  )
  res.status(201).json({ ok: true, id })
})

module.exports = router
