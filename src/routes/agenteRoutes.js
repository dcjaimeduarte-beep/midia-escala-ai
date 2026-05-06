const express = require('express')
const router = express.Router()
const { pastorDaMidia } = require('../agents/pastorDaMidia')
const { listarEspecialistas } = require('../agents/especialistas')

router.get('/especialistas', (_req, res) => {
  res.json({ especialistas: listarEspecialistas() })
})

router.post('/perguntar', async (req, res) => {
  const { pergunta, especialista } = req.body
  if (!pergunta) return res.status(400).json({ erro: 'Campo "pergunta" é obrigatório' })

  try {
    const resultado = await pastorDaMidia(pergunta, especialista)
    res.json(resultado)
  } catch (err) {
    console.error('[agente]', err)
    const status = err?.status || err?.statusCode
    const msg = String(err?.message || '')
    let erro = 'Não foi possível obter resposta do Pastor da Mídia. Tente novamente em instantes.'
    if (status === 401 || msg.includes('401') || /api[_ ]?key/i.test(msg)) {
      erro =
        'Chave da API de IA ausente ou inválida. Configure ANTHROPIC_API_KEY no arquivo .env.'
    } else if (status === 429 || msg.includes('rate')) {
      erro = 'Limite de uso do serviço de IA atingido. Aguarde um pouco e tente de novo.'
    }
    res.status(500).json({ erro })
  }
})

router.post('/validar-mudanca', async (req, res) => {
  const { mudanca, checklist, especialista } = req.body || {}
  if (!mudanca) return res.status(400).json({ erro: 'Campo "mudanca" é obrigatório' })

  const especialistaEscolhido = especialista || 'teste_fluxo'
  const itensChecklist = Array.isArray(checklist) ? checklist : []
  const prompt = `Valide a seguinte mudança em modo gate de QA:

Mudança:
${mudanca}

Checklist obrigatório:
${itensChecklist.length ? itensChecklist.map((c, i) => `${i + 1}. ${c}`).join('\n') : '- Sem checklist explícito (use suíte padrão do sistema)'}

Regras de saída:
- STATUS final: APROVADO ou REPROVADO
- ASSERTIVIDADE em porcentagem
- Lista de testes PASSOU/FALHOU
- Se houver falha, detalhe causa raiz e correção recomendada
- Só APROVADO com 100% e zero falhas críticas.`

  try {
    const resultado = await pastorDaMidia(prompt, especialistaEscolhido)
    res.json(resultado)
  } catch (err) {
    console.error('[agente/validar-mudanca]', err)
    res.status(500).json({ erro: 'Não foi possível validar a mudança agora.' })
  }
})

module.exports = router
