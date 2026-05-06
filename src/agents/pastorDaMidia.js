const Anthropic = require('@anthropic-ai/sdk')
const moment = require('moment')
const db = require('../models/db')
const eventBus = require('../events/eventBus')
const { criarEscalaNoBanco, buscarEscalasComVoluntarios } = require('../services/escalasDb')
const { syncEscalasParaMemoria } = require('../db/bootstrap')
const { resolverEspecialista } = require('./especialistas')

const client = new Anthropic()

// Converte DD/MM/AAAA → YYYY-MM-DD para comparação interna
function parseDateBR(dataBR) {
  return moment(dataBR, 'DD/MM/YYYY').format('YYYY-MM-DD')
}

// Converte YYYY-MM-DD → DD/MM/AAAA para exibição
function formatDateBR(dateISO) {
  return moment(dateISO, 'YYYY-MM-DD').format('DD/MM/YYYY')
}

// System prompt rico o suficiente para ativar prompt caching (>2048 tokens no Sonnet 4.6)
const SYSTEM_PROMPT = `Você é o Pastor da Mídia — um agente de inteligência artificial especializado em gerenciar, organizar e inspirar a equipe de mídia de uma igreja. Você age com proatividade, criatividade e excelência pastoral.

## Identidade e Missão

Você não é apenas um gerenciador de escalas. Você é um líder digital que:
- Conhece cada membro da equipe pelo nome e pelas habilidades
- Antecipa necessidades antes mesmo de serem pedidas
- Distribui responsabilidades com sabedoria e equidade
- Celebra a dedicação dos voluntários
- Garante que nenhum culto ou evento fique sem cobertura de mídia

## Departamentos que você gerencia

- **Câmera / Filmagem**: Operadores de câmera, direção de imagem ao vivo
- **Transmissão / Live**: Operadores de stream, configuração de OBS/VMix
- **Projeção / Letras**: Responsáveis pelos slides de letras e apresentações
- **Som / Áudio**: Técnicos de som, mixagem ao vivo
- **Design / Redes Sociais**: Criação de conteúdo, posts pós-culto
- **Fotografia**: Registro fotográfico dos cultos e eventos

## Como você trabalha

Antes de criar qualquer escala:
1. Verifique os departamentos disponíveis
2. Liste os membros daquele departamento
3. Verifique quem já está escalado na data
4. Sugira os disponíveis com base na rotatividade e equidade
5. Crie a escala e notifique a equipe

Quando responder, seja:
- **Pastoral**: Use tom acolhedor, motivador e de cuidado com as pessoas
- **Preciso**: Confirme nomes, datas e departamentos antes de agir
- **Proativo**: Se perceber lacunas nas escalas, aponte e ofereça soluções
- **Dinâmico**: Adapte-se à situação — cultos especiais, feriados, eventos requerem atenção especial

## Regras de negócio que você deve seguir

- Nenhum voluntário deve ser escalado mais de 3 vezes por mês no mesmo departamento
- Sempre que possível, escale duplas (nunca deixe alguém sozinho em câmera ou som)
- Domingos de manhã e noite são escalas diferentes
- Datas especiais (Natal, Páscoa, Celebrações) precisam de equipe reforçada
- Avise com pelo menos 7 dias de antecedência

## Datas e formato

Sempre use o formato brasileiro de data: **DD/MM/AAAA** (ex: 11/05/2026). Nunca use o formato americano YYYY-MM-DD nas respostas. Ao receber uma data do usuário, interprete-a como DD/MM/AAAA e passe às ferramentas nesse mesmo formato.

## Respostas em português

Sempre responda em português brasileiro. Use linguagem clara, direta e pastoral. Evite jargões técnicos desnecessários. Quando listar voluntários ou escalas, use formatação limpa e legível.`

const tools = [
  {
    name: 'listar_departamentos',
    description: 'Lista todos os departamentos cadastrados na equipe de mídia. Use antes de criar escalas.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'listar_usuarios',
    description: 'Lista voluntários cadastrados. Pode filtrar por departamento.',
    input_schema: {
      type: 'object',
      properties: {
        departamento_id: {
          type: 'string',
          description: 'ID do departamento para filtrar (opcional)'
        }
      },
      required: []
    }
  },
  {
    name: 'sugerir_voluntarios',
    description: 'Verifica disponibilidade e sugere voluntários para uma data e departamento. Considera quem já está escalado.',
    input_schema: {
      type: 'object',
      properties: {
        departamento_id: { type: 'string', description: 'ID do departamento' },
        data: { type: 'string', description: 'Data no formato DD/MM/AAAA (ex: 11/05/2026)' }
      },
      required: ['departamento_id', 'data']
    }
  },
  {
    name: 'criar_escala',
    description: 'Cria uma nova escala de serviço. Emite evento no eventBus ao criar.',
    input_schema: {
      type: 'object',
      properties: {
        departamento_id: { type: 'string', description: 'ID do departamento' },
        data: { type: 'string', description: 'Data no formato DD/MM/AAAA (ex: 11/05/2026)' },
        voluntarios: {
          type: 'array',
          items: { type: 'string' },
          description: 'IDs dos voluntários escalados'
        },
        observacao: { type: 'string', description: 'Observação opcional sobre a escala' }
      },
      required: ['departamento_id', 'data']
    }
  },
  {
    name: 'listar_escalas',
    description: 'Lista escalas existentes. Pode filtrar por período ou departamento.',
    input_schema: {
      type: 'object',
      properties: {
        departamento_id: { type: 'string', description: 'Filtrar por departamento (opcional)' },
        data_inicio: { type: 'string', description: 'Data inicial DD/MM/AAAA (opcional)' },
        data_fim: { type: 'string', description: 'Data final DD/MM/AAAA (opcional)' }
      },
      required: []
    }
  },
  {
    name: 'notificar_equipe',
    description: 'Envia notificação para a equipe via eventBus. Use para comunicar escalas, avisos e urgências.',
    input_schema: {
      type: 'object',
      properties: {
        mensagem: { type: 'string', description: 'Conteúdo da notificação' },
        tipo: {
          type: 'string',
          enum: ['aviso', 'escala', 'urgente', 'elogio'],
          description: 'Tipo da notificação'
        },
        destinatarios: {
          type: 'array',
          items: { type: 'string' },
          description: 'IDs dos destinatários (vazio = toda equipe)'
        }
      },
      required: ['mensagem', 'tipo']
    }
  }
]

function executarFerramenta(nome, input) {
  switch (nome) {
    case 'listar_departamentos':
      return JSON.stringify(db.departamentos.length
        ? db.departamentos
        : [{ aviso: 'Nenhum departamento cadastrado ainda.' }])

    case 'listar_usuarios': {
      if (input.departamento_id) {
        const ids = db.usuario_departamento
          .filter(ud => ud.departamento_id === input.departamento_id)
          .map(ud => ud.usuario_id)
        const membros = db.usuarios.filter(u => ids.includes(u.id))
        return JSON.stringify(membros.length ? membros : [{ aviso: 'Nenhum membro neste departamento.' }])
      }
      return JSON.stringify(db.usuarios.length ? db.usuarios : [{ aviso: 'Nenhum usuário cadastrado.' }])
    }

    case 'sugerir_voluntarios': {
      const { departamento_id, data } = input
      const dataISO = parseDateBR(data)
      const dataNorm = (d) => {
        if (!d) return ''
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return parseDateBR(d)
        return d
      }
      const escalasNaData = db.escalas.filter((e) => dataNorm(e.data) === dataISO)
      const escalados = escalasNaData.flatMap((e) =>
        (e.voluntarios || []).map((v) => (typeof v === 'string' ? v : v.usuario_id))
      )

      const ids = db.usuario_departamento
        .filter(ud => ud.departamento_id === departamento_id)
        .map(ud => ud.usuario_id)

      const membros = db.usuarios
        .filter(u => ids.includes(u.id))
        .map(u => ({ ...u, disponivel: !escalados.includes(u.id) }))

      return JSON.stringify({ data, departamento_id, membros })
    }

    case 'criar_escala': {
      const id = criarEscalaNoBanco({
        data: input.data,
        departamento_id: input.departamento_id,
        evento_id: null,
        observacao: input.observacao || '',
        criado_por: null,
        voluntarios: input.voluntarios || []
      })
      syncEscalasParaMemoria()
      const todas = buscarEscalasComVoluntarios()
      const escala = todas.find((e) => e.id === id)
      if (!escala) return JSON.stringify({ erro: 'Escala criada mas não foi possível reler os dados.' })
      eventBus.emit('escala_criada', { ...escala, data_br: input.data })
      return JSON.stringify({ sucesso: true, escala: { ...escala, data: input.data } })
    }

    case 'listar_escalas': {
      const toISO = (d) => {
        if (!d) return ''
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return parseDateBR(d)
        return d
      }
      const toBR = (d) => {
        if (!d) return ''
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d
        return formatDateBR(d)
      }
      let escalas = [...db.escalas]
      if (input.departamento_id)
        escalas = escalas.filter((e) => e.departamento_id === input.departamento_id)
      if (input.data_inicio) {
        const ini = parseDateBR(input.data_inicio)
        escalas = escalas.filter((e) => toISO(e.data) >= ini)
      }
      if (input.data_fim) {
        const fim = parseDateBR(input.data_fim)
        escalas = escalas.filter((e) => toISO(e.data) <= fim)
      }
      const resultado = escalas.map((e) => ({ ...e, data: toBR(e.data) }))
      return JSON.stringify(resultado.length ? resultado : [{ aviso: 'Nenhuma escala encontrada.' }])
    }

    case 'notificar_equipe': {
      const notificacao = {
        mensagem: input.mensagem,
        tipo: input.tipo,
        destinatarios: input.destinatarios || [],
        timestamp: new Date().toISOString()
      }
      eventBus.emit('notificacao_equipe', notificacao)
      return JSON.stringify({ sucesso: true, notificacao })
    }

    default:
      return JSON.stringify({ erro: `Ferramenta '${nome}' não reconhecida` })
  }
}

async function pastorDaMidia(pergunta, especialistaId = 'pastor') {
  const especialista = resolverEspecialista(especialistaId)
  const systemPrompt = `${SYSTEM_PROMPT}

## Especialista ativo
${especialista.nome}
Foco: ${especialista.foco}

Diretriz adicional:
${especialista.prompt_extra}`
  const messages = [{ role: 'user', content: pergunta }]

  let response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' } // system prompt cache — reused across calls
      }
    ],
    tools,
    messages
  })

  // Agentic loop — continues while the model requests tools
  while (response.stop_reason === 'tool_use') {
    messages.push({ role: 'assistant', content: response.content })

    const resultados = []
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const resultado = executarFerramenta(block.name, block.input)
        resultados.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultado
        })
      }
    }

    messages.push({ role: 'user', content: resultados })

    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' }
        }
      ],
      tools,
      messages
    })
  }

  const texto = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  return {
    resposta:
      texto.trim() ||
      'Não consegui gerar uma resposta agora. Pode reformular ou tentar de novo em instantes?',
    uso: response.usage
  }
}

module.exports = { pastorDaMidia }
