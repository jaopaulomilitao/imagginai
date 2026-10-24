// são centralizados aqui todos os textos exibidos ao usuário (pt-BR)
export const PT_BR = {
  appName: 'IMAGGINAI',
  nav: {
    zones: 'Minhas Zonas',
    privacyAndConsent: 'Privacidade e Dados',
    login: 'Entrar / Conta',
    logout: 'Sair',
    guestMode: 'Modo Local (Offline)',
  },
  auth: {
    title: 'Acesse sua conta IMAGGINAI',
    subtitle:
      'Conecte-se com e-mail para sincronizar Zonas e processar novos PDFs na nuvem, ou estude imediatamente no modo local com os pacotes demonstrativos.',
    emailLabel: 'E-mail acadêmico ou pessoal',
    emailPlaceholder: 'voce@exemplo.com.br',
    passwordLabel: 'Senha',
    passwordPlaceholder: 'Mínimo de 6 caracteres',
    signInButton: 'Entrar com E-mail',
    signUpButton: 'Criar Conta Gratuita',
    anonymousButton: 'Entrar Anonimamente (Supabase)',
    continueLocalButton: 'Continuar no Modo Local (Sem Conta)',
    switchToSignUp: 'Ainda não tem conta? Cadastre-se',
    switchToSignIn: 'Já possui conta? Faça login',
    signUpSuccess:
      'Conta criada! Caso a confirmação de e-mail esteja ativa no Supabase, verifique sua caixa de entrada ou faça login.',
    backToZones: 'Voltar para Zonas',
  },
  home: {
    title: 'Suas Zonas de Estudo Espacial',
    subtitle:
      'Crie Zonas temáticas, envie apostilas em PDF para extração com Grounding semântico e estude em WebXR 100% offline.',
    openDemoZone: 'Entrar na Zona (VR)',
    prepareAndReview: 'Preparar / Revisar PDF',
    createZoneTitle: 'Criar Nova Zona',
    zoneNameLabel: 'Nome da Zona de estudo',
    zoneNamePlaceholder: 'Ex.: Circuitos Elétricos CC — Prova 1',
    environmentLabel: 'Ambiente visual na Zona XR',
    createButton: 'Criar Zona',
    creatingButton: 'Criando...',
    deleteConfirm: 'Excluir Zona',
    emptyZones: 'Nenhuma Zona encontrada. Crie sua primeira Zona acima!',
    statusReadyOffline: 'Pacote pronto (Offline)',
    statusAwaitingPdf: 'Aguardando upload de PDF',
    demoBadge: 'Demo Oficial',
    syncCloudBadge: 'Sincronizada',
    localBadge: 'Local (Dexie)',
    resumeBanner: {
      badge: 'Retomar de onde parou',
      title: (zoneName: string) => `Última sessão em "${zoneName}"`,
      details: (blocks: number, exitedAtFormatted: string) =>
        `${blocks} bloco(s) Pomodoro concluído(s) • última saída em ${exitedAtFormatted}`,
      resumeButton: 'Retomar na Zona (VR)',
      reviewButton: 'Revisar Conceitos',
    },
  },
  zoneDetail: {
    backToZones: 'Voltar para Minhas Zonas',
    settingsTitle: 'Configurações da Zona',
    saveSettingsButton: 'Salvar Alterações',
    uploadSectionTitle: '1. Enviar Apostila ou Artigo (PDF)',
    uploadSectionSubtitle:
      'Limites: até 20 MB e 60 páginas por documento. O texto é dividido por página com PyMuPDF e verificado por similaridade de cosseno (≥ 0,70).',
    selectPdfLabel: 'Selecionar arquivo PDF',
    docTitleLabel: 'Título da fonte (opcional)',
    docTitlePlaceholder: 'Ex.: Apostila de Circuitos Elétricos CC',
    uploadButton: 'Processar PDF e Gerar Study Pack',
    uploadingButton: 'Processando documento...',
    authRequiredNotice:
      'Para enviar um novo PDF ao servidor FastAPI + Gemini, entre com sua conta Supabase em "Entrar / Conta". Você já pode revisar e editar qualquer Zona demonstrativa localmente!',
    jobStages: {
      queued: 'Na fila de processamento...',
      extracting: 'Extraindo páginas e criando chunks com âncoras de página (PyMuPDF)...',
      embedding: 'Calculando embeddings vetoriais de 768 dimensões (Gemini)...',
      storing: 'Persistindo chunks verificáveis no banco vetorial...',
      generating:
        'Extraindo conceitos, cartões, quiz e ativos 3D com verificação de Grounding (≥ 0,70)...',
      done: 'Study Pack gerado, validado e salvo para estudo offline!',
      failed: 'Falha ao processar o PDF:',
    },
    reviewSectionTitle: '2. Revisão do Study Pack e Curadoria de Conceitos',
    reviewSectionSubtitle:
      'Revise os conceitos extraídos antes de vestir o óculos VR. Você pode renomear rótulos/definições ou remover conceitos irrelevantes.',
    statsConcepts: 'Conceitos validados',
    statsCards: 'Cartões de estudo',
    statsQuiz: 'Questões de Quiz',
    statsAssets: 'Ativos Espaciais 3D',
    statsDiscarded: (count: number) => `${count} descartado(s) pelo filtro de Grounding (< 0,70)`,
    conceptLabelInput: 'Rótulo do conceito (máx. 40 caracteres)',
    conceptDefInput: 'Definição fundamentada (máx. 280 caracteres)',
    saveConceptButton: 'Salvar',
    cancelEditButton: 'Cancelar',
    editConceptButton: 'Renomear / Editar',
    removeConceptButton: 'Remover',
    enterZoneCtaTitle: '3. Handoff para a Zona Espacial (WebXR)',
    enterZoneCtaSubtitle:
      'O Study Pack e o PDF já estão salvos no IndexedDB (Dexie). Durante a sessão na Zona, zero requisições de rede são feitas.',
    enterZoneButton: 'Entrar na Zona (VR)',
  },
  consent: {
    modalTitle: 'Privacidade, Telemetria e Consentimento (LGPD)',
    modalSubtitle:
      'Antes de entrar na sua primeira Zona Espacial, escolha como seus dados de estudo são processados. Jamais transmitimos imagens da câmera, áudio ou séries de coordenadas das mãos.',
    telemetryLocalTitle: 'Métricas pessoais de estudo no dispositivo (obrigatório)',
    telemetryLocalDesc:
      'Registra localmente no IndexedDB (Dexie) o tempo de foco, conceitos revisados e acertos nos quizzes para exibir seu painel pessoal de evolução.',
    researchTitle: 'Compartilhar agregados anônimos para pesquisa (opcional)',
    researchDesc:
      'Ao sair da Zona, envia apenas totais agregados da sessão (tempo de foco, taxa de acerto por conceito e FPS médio/p10). Nenhum dado bruto ou biométrico é enviado.',
    confirmAndProceed: 'Salvar Preferências e Continuar',
    deleteMyDataButton: 'Excluir todos os meus dados (Local + Servidor)',
    deleteMyDataConfirm: 'Tem certeza? Clique novamente para apagar tudo',
    deleteMyDataDone: 'Todos os dados locais e remotos foram removidos.',
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
        'open-contents': {
          icon: '⊞',
          label: 'Conteúdos',
        },
        'toggle-mode': {
          icon: '◐',
          label: 'Modo',
        },
        'toggle-theme': {
          icon: '🌓',
          label: 'Tema',
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
        themeChanged: (name: string) => `Tema: ${name}`,
        zonesPickerTitle: 'Zonas baixadas (offline)',
        contentsPickerTitle: 'Conteúdos extraídos — escolha para adicionar ao painel',
        contentAddedToPanel: (title: string) => `Conteúdo adicionado: ${title}`,
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
