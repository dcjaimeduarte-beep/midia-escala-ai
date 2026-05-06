const { v4: uuidv4 } = require('uuid')
const db = require('../models/db')

const listar = (req, res) => {
  res.json(db.departamentos)
}

const buscarPorId = (req, res) => {
  const departamento = db.departamentos.find(d => d.id === req.params.id)
  if (!departamento) return res.status(404).json({ erro: 'Departamento não encontrado' })
  res.json(departamento)
}

const criar = (req, res) => {
  const { nome, descricao } = req.body
  if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' })

  const novo = { id: uuidv4(), nome, descricao: descricao || '', ativo: true }
  db.departamentos.push(novo)
  res.status(201).json(novo)
}

const atualizar = (req, res) => {
  const index = db.departamentos.findIndex(d => d.id === req.params.id)
  if (index === -1) return res.status(404).json({ erro: 'Departamento não encontrado' })

  db.departamentos[index] = { ...db.departamentos[index], ...req.body }
  res.json(db.departamentos[index])
}

const remover = (req, res) => {
  const index = db.departamentos.findIndex(d => d.id === req.params.id)
  if (index === -1) return res.status(404).json({ erro: 'Departamento não encontrado' })

  db.departamentos.splice(index, 1)
  res.status(204).send()
}

module.exports = { listar, buscarPorId, criar, atualizar, remover }
