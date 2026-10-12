// são centralizados aqui todos os textos exibidos ao usuário (pt-BR)
export const PT_BR = {
  appName: 'IMAGGINAI',
  home: {
    title: 'Suas Zonas de estudo',
    subtitle: 'Prepare o material, entre na Zona e revise seu desempenho.',
    openDemoZone: 'Abrir Zona de demonstração',
  },
  notFound: {
    title: 'Página não encontrada',
    backHome: 'Voltar ao início',
  },
  zone: {
    title: 'IMAGGINAI — Zona',
    startHeading: 'Zona de Estudo',
    startDescription:
      'Posicione o celular no óculos VR e permita o acesso à câmera traseira para rastreamento das mãos e modo passthrough.',
    startButton: 'Entrar na Zona (VR)',
    startErrorPrefix: 'Não foi possível iniciar a câmera ou o modo VR:',
    modeLabels: {
      focus: 'Foco',
      passthrough: 'Passthrough',
    },
    environmentLabels: {
      'focus-dark': 'Foco Escuro',
      'focus-nature': 'Foco Natureza',
    },
    panels: {
      sourceCitationPrefix: 'Fonte: pág.',
      pdfPrevPage: '◀ Ant.',
      pdfNextPage: 'Próx. ▶',
      pdfPageIndicator: (current: number, total: number) => `Pág. ${current} / ${total}`,
      radiusNearer: '−',
      radiusFarther: '+',
    },
  },
} as const;
