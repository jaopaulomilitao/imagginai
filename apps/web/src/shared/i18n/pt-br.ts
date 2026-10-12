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
    belt: {
      items: {
        'exit-zone': {
          icon: '⏻',
          label: 'Sair',
          confirmLabel: 'Confirmar?',
        },
        'switch-zone': {
          icon: '◈',
          label: 'Zonas',
        },
        'toggle-mode': {
          icon: '◐',
          label: 'Modo',
        },
        'toggle-pomodoro': {
          icon: '◷',
          label: 'Pomodoro',
        },
        recenter: {
          icon: '⌖',
          label: 'Recentrar',
        },
        'ai-assistant': {
          icon: '✦',
          label: 'IA (em breve)',
        },
      },
      feedback: {
        exitConfirmPrompt: 'Confirme em até 3 s para sair da Zona',
        recentered: 'Painéis recentralizados à sua frente',
        aiDisabled: 'Assistente de IA: em breve (desativado no MVP)',
        zonesPickerTitle: 'Zonas baixadas (offline)',
        demoZoneName: 'Sistema Cardiovascular (Demo)',
        zoneSwitched: (name: string) => `Zona ativa: ${name}`,
      },
    },
    pomodoro: {
      idle: 'Pomodoro pronto (25/5)',
      focusRunning: (mmss: string) => `Foco: ${mmss}`,
      focusPaused: (mmss: string) => `Pausado: ${mmss}`,
      oneMinWarning: 'Falta 1 minuto para concluir o bloco de foco',
      breakTitle: 'Hora da pausa (5 min)',
      breakBody:
        'Retire o óculos VRBox, descanse os olhos e hidrate-se antes de iniciar o próximo bloco.',
      breakTimer: (mmss: string) => `Tempo de pausa: ${mmss}`,
      skipBreakButton: 'Iniciar novo bloco',
    },
  },
} as const;
