const brand = {
  nome: 'Peniel',
  nomeCompleto: 'Peniel — Ministério Profético Casa de Adoração',
  subtitulo: 'Ministério Profético',
  descricao: 'Casa de Adoração',

  cores: {
    primaria: '#D4161B',      // vermelho oficial da logo
    chama: '#E8000D',         // vermelho da chama vazada
    dourado: '#FFB300',       // base dourada da chama
    doradoClaro: '#FFD54F',   // dourado suave para destaques
    branco: '#FFFFFF',
    fundo: '#0F0000',         // fundo escuro quase preto com tom vermelho
    fundoCard: '#1A0505',     // cards sobre fundo escuro
    fundoClaro: '#FFF5F5',    // fundo claro para painéis
    texto: '#FFFFFF',
    textoEscuro: '#1A0000',
    textoMutado: '#A08080',
    borda: '#4A1010',
    bordaClara: '#FFD0D0',
    sucesso: '#4CAF50',
    alerta: '#FF9800',
    erro: '#F44336',
    info: '#2196F3'
  },

  tipografia: {
    fonteDisplay: "'Playfair Display', 'Georgia', serif",       // Peniel / títulos
    fonteCorpo: "'Inter', 'Segoe UI', sans-serif",              // textos gerais
    fonteScript: "'Dancing Script', 'Pinyon Script', cursive",  // elemento decorativo
    tamanhos: {
      xs: '0.75rem',
      sm: '0.875rem',
      base: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
      '2xl': '1.5rem',
      '3xl': '1.875rem',
      '4xl': '2.25rem'
    }
  },

  logos: {
    principal: '/docs/LOGO OFICIAL.png',
    icone: '/docs/Foguinho vazado.png'
  },

  gradientes: {
    primario: 'linear-gradient(135deg, #D4161B 0%, #8B0000 100%)',
    chama: 'linear-gradient(180deg, #E8000D 0%, #FFB300 100%)',
    escuro: 'linear-gradient(135deg, #0F0000 0%, #1A0505 100%)',
    hero: 'linear-gradient(135deg, #1A0000 0%, #3D0000 50%, #1A0000 100%)'
  },

  sombras: {
    card: '0 4px 24px rgba(212, 22, 27, 0.15)',
    destaque: '0 0 20px rgba(232, 0, 13, 0.4)',
    suave: '0 2px 8px rgba(0,0,0,0.3)'
  },

  bordas: {
    raio: '8px',
    raioGrande: '16px',
    raioCirculo: '50%'
  }
}

module.exports = brand
