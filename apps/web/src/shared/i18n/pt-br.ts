// centraliza todos os textos exibidos ao estudante (pt-br) com linguagem direta, natural e sem jargões técnicos
export const PT_BR = {
  appName: 'IMAGGINAI',
  nav: {
    zones: 'Minhas Zonas',
    dashboard: 'Desempenho & Pesquisa',
    privacyAndConsent: 'Privacidade & LGPD',
    preferences: 'Preferências',
    handModel: 'Mão 3D na Zona',
    login: 'Entrar',
    logout: 'Sair',
    guestMode: 'Modo Local',
    toggleThemeAria: 'Alternar tema claro ou escuro',
  },
  auth: {
    title: 'Entre na sua conta',
    subtitle:
      'Conecte-se com seu e-mail para enviar novos PDFs e sincronizar seus espaços de estudo, ou continue direto no dispositivo com as Zonas de exemplo.',
    emailLabel: 'Seu e-mail',
    emailPlaceholder: 'voce@exemplo.com.br',
    passwordLabel: 'Sua senha',
    passwordPlaceholder: 'Mínimo de 6 caracteres',
    signInButton: 'Entrar',
    signUpButton: 'Criar conta gratuita',
    anonymousButton: 'Entrar como visitante',
    continueLocalButton: 'Estudar sem conta',
    switchToSignUp: 'Ainda não tem conta? Cadastre-se',
    switchToSignIn: 'Já tem conta? Faça login',
    signUpSuccess: 'Conta criada com sucesso. Verifique seu e-mail ou faça login para continuar.',
    backToZones: 'Voltar para Zonas',
  },
  home: {
    title: 'Suas Zonas de Estudo',
    subtitle:
      'Organize seus temas de estudo, envie suas apostilas em PDF e revise o conteúdo no seu espaço imersivo 3D.',
    openDemoZone: 'Entrar',
    prepareAndReview: 'Configurar',
    createZoneTitle: 'Criar Nova Zona',
    zoneNameLabel: 'Nome da Zona de estudo',
    zoneNamePlaceholder: 'Ex.: Fisiologia Humana — Prova 1',
    environmentLabel: 'Ambiente na Zona VR',
    createButton: 'Criar Zona',
    creatingButton: 'Criando...',
    deleteConfirm: 'Excluir Zona',
    emptyZones: 'Você ainda não tem nenhuma Zona. Crie sua primeira acima.',
    statusReadyOffline: 'Material pronto para estudo',
    statusAwaitingPdf: 'Aguardando envio de PDF',
    demoBadge: 'Exemplo pronto',
    syncCloudBadge: 'Sincronizada',
    localBadge: 'Salva no dispositivo',
    resumeBanner: {
      badge: 'Continuar estudando',
      title: (zoneName: string) => `Última sessão em "${zoneName}"`,
      details: (blocks: number, exitedAtFormatted: string) =>
        `${blocks} ciclo(s) de foco concluído(s) | última sessão em ${exitedAtFormatted}`,
      resumeButton: 'Continuar',
      reviewButton: 'Revisar material',
    },
  },
  zoneDetail: {
    backToZones: 'Minhas Zonas',
    settingsTitle: 'Configurações da Zona',
    saveSettingsButton: 'Salvar ajustes',
    savedBadge: 'Salvo',
    wizardSteps: {
      step1Title: 'Enviar material',
      step1Desc: 'Escolha seus PDFs',
      step2Title: 'Processamento',
      step2Desc: 'Extração do conteúdo',
      step3Title: 'Revisão do Study Pack e Curadoria',
      step3Desc: 'Organize seu estudo',
      step4Title: 'Entrar na Zona VR',
      step4Desc: 'Iniciar imersão 3D',
    },
    uploadSectionTitle: 'Envie sua apostila ou resumo em PDF',
    uploadSectionSubtitle:
      'Escolha um ou mais arquivos PDF (até 20 MB e 60 páginas cada). O conteúdo será lido e transformado em conceitos, flashcards, perguntas de revisão e objetos de estudo.',
    selectPdfLabel: 'Arquivos PDF (1 ou mais)',
    docTitleLabel: 'Nome do material (opcional)',
    docTitlePlaceholder: 'Ex.: Resumo de Circuitos Elétricos',
    uploadButton: 'Processar material',
    uploadingButton: 'Extraindo conteúdo...',
    authRequiredNotice:
      'Para processar novos arquivos PDF, entre na sua conta pelo botão "Entrar" no topo da página.',
    processingSectionTitle: 'Extraindo e organizando seu material',
    processingSectionSubtitle:
      'Estamos lendo as páginas do seu PDF e preparando os materiais para a sua Zona de estudo.',
    jobStages: {
      queued: 'Preparando leitura do arquivo...',
      extracting: 'Lendo as páginas e separando os tópicos principais do PDF...',
      embedding: 'Identificando as relações entre os tópicos do documento...',
      storing: 'Organizando os trechos de referência por página...',
      generating: 'Montando seus conceitos, flashcards, questões de quiz e objetos de estudo...',
      done: 'Tudo pronto! Seu material foi preparado para estudo.',
      failed: 'Não foi possível processar o PDF:',
    },
    reviewSectionTitle: 'Revisão do Study Pack e Curadoria',
    reviewSectionSubtitle:
      'Confira tudo o que foi extraído do seu material antes de entrar na Zona VR. Você pode filtrar por categoria, editar conceitos ou remover o que não precisar.',
    reviewEmptyTitle: 'Nenhum material processado ainda',
    reviewEmptySubtitle:
      'Envie e processe pelo menos um arquivo PDF na Etapa 1 para liberar a revisão e curadoria do seu Study Pack.',
    goToStep1Button: 'Ir para envio de PDF',
    proceedToStep4Button: 'Avançar para a Zona VR',
    statsConcepts: 'Conceitos',
    statsCards: 'Flashcards',
    statsQuiz: 'Questões de Quiz',
    statsAssets: 'Objetos de Estudo',
    filters: {
      all: 'Todos',
      concepts: 'Conceitos',
      flashcards: 'Flashcards',
      quiz: 'Quiz',
      studyObjects: 'Objetos de Estudo',
    },
    categories: {
      concept: 'Conceito',
      flashcard: 'Flashcard',
      quiz: 'Quiz',
      studyObject: 'Objeto de Estudo',
      studyObjectGraph: 'Mapa de Conceitos 3D',
      studyObjectSequence: 'Linha do Tempo / Sequência',
    },
    conceptLabelInput: 'Título do conceito (máx. 40 caracteres)',
    conceptDefInput: 'Explicação do conceito (máx. 280 caracteres)',
    saveConceptButton: 'Salvar',
    cancelEditButton: 'Cancelar',
    editConceptButton: 'Editar',
    removeConceptButton: 'Remover',
    enterZoneCtaTitle: 'Tudo pronto para entrar na sua Zona VR',
    enterZoneCtaSubtitle:
      'Seu material já está salvo no dispositivo e continuará funcionando mesmo sem conexão com a internet durante a sessão.',
    enterZoneButton: 'Entrar',
  },
  consent: {
    modalTitle: 'Privacidade e seus dados de estudo',
    modalSubtitle:
      'Escolha como registrar seu progresso. Suas imagens da câmera e movimentos das mãos nunca saem do seu aparelho.',
    telemetryLocalTitle: 'Histórico de estudo neste dispositivo (necessário)',
    telemetryLocalDesc:
      'Salva no seu aparelho o tempo de foco e os conteúdos revisados para que você possa retomar de onde parou.',
    researchTitle: 'Compartilhar estatísticas anônimas de uso (opcional)',
    researchDesc:
      'Envia apenas resumos gerais ao encerrar a sessão (tempo de estudo e desempenho técnico) para ajudar a melhorar a plataforma.',
    confirmAndProceed: 'Confirmar e continuar',
    deleteMyDataButton: 'Apagar todos os meus dados',
    deleteMyDataConfirm: 'Tem certeza? Clique novamente para apagar tudo',
    deleteMyDataDone: 'Seus dados foram apagados com sucesso.',
  },
  notFound: {
    title: 'Página não encontrada',
    backHome: 'Voltar para o início',
  },
  zone: {
    title: 'IMAGGINAI — Zona de Estudo',
    startHeading: 'Pronto para entrar na Zona',
    startDescription:
      'Coloque o celular no óculos VR e autorize a câmera para usar os gestos das mãos no seu espaço de estudo.',
    startButton: 'Iniciar Sessão VR',
    startErrorPrefix: 'Não foi possível iniciar a câmera ou o modo VR:',
    modeLabels: {
      focus: 'Foco',
      passthrough: 'Câmera',
    },
    environmentLabels: {
      'focus-dark': 'Estúdio Escuro',
      'focus-nature': 'Horizonte Calmo',
    },
    panels: {
      sourceCitationPrefix: 'Pág.',
      pdfPrevPage: 'Anterior',
      pdfNextPage: 'Próxima',
      pdfPageIndicator: (current: number, total: number) => `Pág. ${current} de ${total}`,
      radiusNearer: 'Aproximar',
      radiusFarther: 'Afastar',
      deletePanel: 'Remover da cena',
      flashcardReveal: 'Revelar',
      flashcardHide: 'Ocultar',
      flashcardBadge: 'FLASHCARD',
      welcomePlaceholderTitle: 'Espaço de Estudo Livre',
      welcomePlaceholderBody:
        'Olhe para baixo e toque em Conteúdos no menu central para adicionar seu PDF, flashcards, quiz ou objetos de estudo à cena.',
    },
    belt: {
      items: {
        'exit-zone': {
          icon: 'sign-out',
          label: 'Sair',
          confirmLabel: 'Confirmar?',
        },
        'switch-zone': {
          icon: 'squares-four',
          label: 'Zonas',
        },
        recenter: {
          icon: 'crosshair',
          label: 'Recentrar',
        },
        'open-contents': {
          icon: 'stack',
          label: 'Conteúdos',
        },
        'toggle-pomodoro': {
          icon: 'timer',
          label: 'Pomodoro',
        },
        'toggle-mode': {
          icon: 'goggles',
          label: 'Modo',
        },
        'toggle-theme': {
          icon: 'sun-dim',
          label: 'Tema',
        },
      },
      contentFilters: {
        content: 'Conteúdo',
        flashcards: 'Flashcards',
        quiz: 'Quiz',
        studyObjects: 'Objetos de Estudo',
      },
      feedback: {
        exitConfirmPrompt: 'Toque novamente em até 3 s para sair da Zona',
        recentered: 'Painéis alinhados à sua frente',
        themeChanged: (name: string) => `Tema alterado: ${name}`,
        zonesPickerTitle: 'Trocar de Zona de estudo',
        contentsPickerTitle: 'Adicionar conteúdos à cena',
        contentAddedToPanel: (title: string) => `Adicionado à cena: ${title}`,
        contentRemovedFromScene: 'Item removido da cena',
        contentAlreadyInScene: 'Na cena',
        demoZoneName: 'Sistema Cardiovascular (Exemplo)',
        zoneSwitched: (name: string) => `Zona ativa: ${name}`,
        prevPage: 'Anterior',
        nextPage: 'Próxima',
      },
    },
    pomodoro: {
      idle: 'Ciclo de foco pronto (25 min)',
      focusRunning: (mmss: string) => `Foco: ${mmss}`,
      focusPaused: (mmss: string) => `Pausado: ${mmss}`,
      oneMinWarning: 'Falta 1 minuto para concluir este ciclo de foco',
      breakTitle: 'Hora de fazer uma pausa (5 min)',
      breakBody:
        'Tire o óculos VR por alguns instantes, descanse a vista e beba água antes do próximo ciclo.',
      breakTimer: (mmss: string) => `Pausa: ${mmss}`,
      skipBreakButton: 'Iniciar novo ciclo',
    },
  },
  dashboard: {
    badge: 'Painel Analítico & Pesquisa',
    title: 'Desempenho do Estudante & Telemetria Educacional',
    subtitle:
      'Acompanhe seu tempo de foco, domínio conceitual e prioridades de revisão, ou alterne para a visão de pesquisador para inspecionar métricas espaciais e exportar dados anonimizados.',
    filterAllZones: 'Todas as Zonas de Estudo',
    lensStudent: 'Visão do Estudante',
    lensResearcher: 'Visão do Pesquisador',
    lensBoth: 'Visão Completa (Estudante + Pesquisador)',
    seedDemoButton: 'Simular Sessões de Estudo (Demo)',
    clearDemoButton: 'Voltar apenas às sessões reais',
    demoBannerTitle: 'Visualizando dados simulados para demonstração',
    demoBannerSubtitle:
      'Estes registros exemplificam sessões completas nas Zonas de demonstração para inspeção imediata dos gráficos do estudante e do pesquisador.',
    studentKpis: {
      focusTimeTitle: 'Tempo de Foco Imersivo',
      focusTimeExplain:
        'Soma do tempo ativo dentro da Zona VR. Indica sua constância em blocos de atenção profunda.',
      quizAccuracyTitle: 'Acurácia Global no Quiz',
      quizAccuracyExplain:
        'Percentual de respostas corretas nas verificações ao final dos ciclos Pomodoro e revisões.',
      conceptCoverageTitle: 'Cobertura de Conceitos',
      conceptCoverageExplain:
        'Fração dos conceitos do seu material que já foram abertos, inspecionados no grafo 3D ou avaliados.',
      sessionsTitle: 'Sessões & Ciclos Concluídos',
      sessionsExplain:
        'Total de sessões registradas no dispositivo ou sincronizadas, junto aos blocos Pomodoro completos.',
    },
    conceptsSection: {
      mostExploredTitle: 'Conceitos Mais Explorados',
      mostExploredExplain:
        'Conceitos nos quais você permaneceu mais tempo em leitura ativa (> 30s) e realizou mais aberturas espaciais.',
      leastExploredTitle: 'Conceitos Menos Explorados (Pontos Cegos)',
      leastExploredExplain:
        'Conceitos com pouco ou nenhum tempo de foco (< 5s). O sistema prioriza automaticamente estes itens no Quiz ao final do Pomodoro.',
      priorityReviewTitle: 'Prioridades Recomendadas para a Próxima Sessão',
      priorityReviewExplain:
        'Combina conceitos ainda não explorados com aqueles em que a taxa de acerto no Quiz ficou abaixo de 70%.',
      quizPerConceptTitle: 'Acurácia de Quiz por Conceito',
      quizPerConceptExplain:
        'Detalhamento de acertos e erros por conceito ancorado à página original do PDF, permitindo identificar lacunas específicas.',
    },
    researcherSection: {
      badge: 'Telemetria Científica & IHC Espacial',
      title: 'Indicadores para Pesquisa em Educação & WebXR',
      subtitle:
        'Métricas agregadas localmente no encerramento da sessão conforme a Seção 3.9, sem qualquer coleta de imagens de câmera, áudio ou séries temporais de pose.',
      pinchTitle: 'Precisão Biomecânica de Pinça',
      pinchExplain:
        'Proporção de gestos de pinça bem-sucedidos sobre alvos 3D versus cliques em falso (miss) e repetições rápidas (< 1s), mensurando a ergonomia do rastreamento de mãos.',
      bucketsTitle: 'Distribuição Cognitiva de Tempo por Conceito',
      bucketsExplain:
        'Agrupa as interações conceituais em varredura rápida (0–5s), leitura intermediária (5–30s) e estudo semântico profundo (> 30s).',
      modeTitle: 'Preferência Ambiental: Foco Isolado vs. Passthrough',
      modeExplain:
        'Compara o tempo de permanência no ambiente virtual de baixo estímulo (Foco) com o modo de vídeo da câmera real (Passthrough).',
      fpsTitle: 'Estabilidade Gráfica & Conforto Visual (FPS P50 / P10)',
      fpsExplain:
        'Mediana (P50) e percentil 10 (P10) da taxa de quadros. Manter P50 ≥ 50 FPS é o critério de conforto visual para evitar fadiga vestibular.',
      sessionsTableTitle: 'Registro de Sessões Agregadas',
      exportJsonButton: 'Exportar JSON Anonimizado',
      exportCsvButton: 'Exportar CSV (R / Python / SPSS)',
      privacyAuditOk:
        'Auditoria LGPD / Seção 3.9 aprovada: 0 campos biométricos brutos (landmarks, vídeo, áudio ou orientação da cabeça) presentes nos registros.',
    },
    masteryLabels: {
      mastered: 'Dominado (≥ 75%)',
      consolidating: 'Em consolidação (50–74%)',
      'needs-review': 'Revisar (< 50%)',
      untested: 'Ainda não avaliado',
    },
    bucketLabels: {
      '0-5s': '0–5s (Varredura)',
      '5-30s': '5–30s (Leitura Ativa)',
      '>30s': '> 30s (Estudo Profundo)',
    },
  },
} as const;
