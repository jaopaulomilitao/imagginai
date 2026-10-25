import AFRAME, { type Component, type Entity } from 'aframe';

import type { QuizItem } from '../../shared/types/study-pack';
import { formatCardCitation } from './imx-card-panel';
import {
  QuizSessionController,
  type QuizAnswerFeedback,
} from '../systems/learning-assets-controller';
import { createPhosphorIconEntity } from '../systems/phosphor-icon-canvas';
import {
  getThemePalette,
  resolveInitialTheme,
  ZONE_THEME_CHANGE_EVENT,
  ZONE_THEME_STORAGE_KEY,
} from '../systems/theme-controller';
import type { ZoneTheme } from '../config/constants';

export const QUIZ_ANSWER_EVENT = 'imx-quiz-answer';

export interface QuizAnswerEventDetail {
  readonly questionId: string;
  readonly conceptIds: readonly string[];
  readonly selectedIndex: number;
  readonly correctIndex: number;
  readonly isCorrect: boolean;
}

export interface QuizPanelData {
  quizId: string;
  sourceTitle: string;
}

export interface QuizPanelComponent extends Component<QuizPanelData> {
  controller?: QuizPanelBridge;
}

function createQuizTroikaText(options: {
  position: string;
  value: string;
  color: string;
  fontSize: number;
  maxWidth: number;
  align?: string;
  anchor?: string;
  baseline?: string;
}): Entity {
  const el = document.createElement('a-troika-text') as Entity;
  const align = options.align ?? 'center';
  const anchor = options.anchor ?? 'center';
  const baseline = options.baseline ?? 'center';
  el.setAttribute('position', options.position);
  el.setAttribute('value', options.value);
  el.setAttribute('color', options.color);
  el.setAttribute('align', align);
  el.setAttribute('anchor', anchor);
  el.setAttribute('baseline', baseline);
  el.setAttribute('font-size', String(options.fontSize));
  el.setAttribute('fontSize', String(options.fontSize));
  el.setAttribute('max-width', String(options.maxWidth));
  el.setAttribute('maxWidth', String(options.maxWidth));
  el.setAttribute('line-height', '1.24');
  el.setAttribute(
    'troika-text',
    `value: ${options.value}; color: ${options.color}; fontSize: ${options.fontSize}; maxWidth: ${options.maxWidth}; lineHeight: 1.24; align: ${align}; anchor: ${anchor}; baseline: ${baseline}`,
  );
  return el;
}

// painel interativo de quiz com layout dinâmico sem truncamento, contraste adaptativo e sincronização de estado (seções 2.2 e 3.6.4)
export class QuizPanelBridge {
  private quizController: QuizSessionController | null = null;
  private readonly rootGroupEl: Entity;
  private currentTheme: ZoneTheme;

  private readonly onThemeChange = (event: Event): void => {
    const detail = (event as CustomEvent<{ theme: ZoneTheme }>).detail;
    if (detail?.theme) {
      this.currentTheme = detail.theme;
      this.renderCurrentQuestion();
    }
  };

  constructor(
    private readonly el: Entity,
    private data: QuizPanelData,
  ) {
    let storedPref: string | null = null;
    try {
      storedPref = localStorage.getItem(ZONE_THEME_STORAGE_KEY);
    } catch {
      // ignora caso o armazenamento local não esteja disponível
    }
    this.currentTheme = resolveInitialTheme(storedPref);

    this.rootGroupEl = document.createElement('a-entity') as Entity;
    this.rootGroupEl.setAttribute('position', '0 0 0.014');
    this.el.appendChild(this.rootGroupEl);

    window.addEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
  }

  updateData(nextData: QuizPanelData): void {
    this.data = nextData;
  }

  setQuestions(items: readonly QuizItem[]): void {
    this.quizController = new QuizSessionController(items);
    this.renderCurrentQuestion();
  }

  selectOption(optionIndex: number): QuizAnswerFeedback | null {
    if (!this.quizController) return null;
    const feedback = this.quizController.submitAnswer(optionIndex);
    if (!feedback) return null;

    this.renderCurrentQuestion();

    const detail: QuizAnswerEventDetail = {
      questionId: feedback.questionId,
      conceptIds: feedback.conceptIds,
      selectedIndex: feedback.selectedIndex,
      correctIndex: feedback.correctIndex,
      isCorrect: feedback.isCorrect,
    };
    this.el.sceneEl?.emit(QUIZ_ANSWER_EVENT, detail);
    return feedback;
  }

  dispose(): void {
    window.removeEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
    this.rootGroupEl.remove();
  }

  private renderCurrentQuestion(): void {
    while (this.rootGroupEl.firstChild) {
      this.rootGroupEl.removeChild(this.rootGroupEl.firstChild);
    }
    if (!this.quizController) return;

    const current = this.quizController.getCurrentQuestion();
    if (!current) return;

    const idx = this.quizController.getCurrentIndex();
    const total = this.quizController.getTotalQuestions();
    const score = this.quizController.getScoreSummary();
    const answer = this.quizController.getAnswerForCurrent();
    const palette = getThemePalette(this.currentTheme);
    const isLight = this.currentTheme === 'light-glass';

    const headerTitle =
      total > 1
        ? `Quiz (${idx + 1}/${total}) — Acertos: ${score.correct}/${score.answered}`
        : `Questão de Quiz`;
    this.el.setAttribute('imx-panel', 'title', headerTitle);

    // 1. cálculo antecipado das alturas dos blocos para ajuste dinâmico do painel (seção 4)
    const optW = 0.76;
    const promptLines = Math.max(1, Math.ceil(current.prompt.length / 52));
    const promptH = 0.026 + (promptLines - 1) * 0.022;

    const optionDimensions = current.options.map((optText, optIdx) => {
      const letter = String.fromCharCode(65 + optIdx);
      const fullText = `${letter}) ${optText}`;
      const lines = Math.max(1, Math.ceil(fullText.length / 46));
      const optH = Math.max(0.048, 0.026 + (lines - 1) * 0.022);
      return { fullText, optH, optIdx };
    });
    const totalOptionsH = optionDimensions.reduce((acc, o) => acc + o.optH + 0.012, 0);

    let expH = 0;
    let fullExpText = '';
    if (answer) {
      const verdict = answer.isCorrect ? 'Correto!' : 'Incorreto.';
      fullExpText = `${verdict} ${answer.explanation}`;
      const expLines = Math.max(1, Math.ceil(fullExpText.length / 50));
      expH = Math.max(0.048, 0.024 + expLines * 0.02);
    }

    const navH = 0.044;
    // soma vertical: header (0.115) + prompt + gap + opções + gap + explicação + gap + navegação + footer (0.065)
    const neededHeight =
      0.115 + promptH + 0.022 + totalOptionsH + (answer ? expH + 0.018 : 0) + 0.016 + navH + 0.065;
    const calculatedPanelH = Math.max(0.7, Math.round(neededHeight * 100) / 100);

    this.el.setAttribute('imx-panel', {
      width: 0.84,
      height: calculatedPanelH,
      body: '',
      accentColor: '#EA580C',
    });

    // 2. posicionamento estritamente sequencial de cima para baixo (evita sobreposição de elementos)
    let currentY = calculatedPanelH / 2 - 0.115;

    // pergunta do quiz com contraste adaptado
    const promptColor = isLight ? '#121316' : '#F5F3EB';
    const promptY = currentY - promptH / 2;
    currentY -= promptH + 0.022;

    const promptEl = createQuizTroikaText({
      position: `0 ${promptY} 0.004`,
      value: current.prompt,
      color: promptColor,
      fontSize: 0.016,
      maxWidth: 0.76,
      align: 'center',
      anchor: 'center',
      baseline: 'center',
    });
    this.rootGroupEl.appendChild(promptEl);

    // alternativas com quebra de linha dinâmica
    optionDimensions.forEach(({ fullText, optH, optIdx }) => {
      const y = currentY - optH / 2;
      currentY -= optH + 0.012;

      let borderColor = isLight ? '#E2E8F0' : '#2E323B';
      let bgColor = isLight ? '#FFFFFF' : '#18181B';
      let textColor = isLight ? '#121316' : '#F5F3EB';

      if (answer) {
        if (optIdx === answer.correctIndex) {
          borderColor = '#10B981';
          bgColor = isLight ? '#ECFDF5' : '#064E3B';
          textColor = isLight ? '#065F46' : '#ECFDF5';
        } else if (optIdx === answer.selectedIndex && !answer.isCorrect) {
          borderColor = '#EF4444';
          bgColor = isLight ? '#FEF2F2' : '#7F1D1D';
          textColor = isLight ? '#991B1B' : '#FEF2F2';
        }
      }

      const borderEl = document.createElement('a-plane') as Entity;
      borderEl.setAttribute('width', String(optW + 0.004));
      borderEl.setAttribute('height', String(optH + 0.004));
      borderEl.setAttribute('position', `0 ${y} 0`);
      borderEl.setAttribute(
        'material',
        `shader: flat; color: ${borderColor}; opacity: 0.96; transparent: true`,
      );
      this.rootGroupEl.appendChild(borderEl);

      const btnEl = document.createElement('a-plane') as Entity;
      btnEl.classList.add('interactable');
      btnEl.setAttribute('width', String(optW));
      btnEl.setAttribute('height', String(optH));
      btnEl.setAttribute('position', `0 ${y} 0.002`);
      btnEl.setAttribute(
        'material',
        `shader: flat; color: ${bgColor}; opacity: 0.96; transparent: true`,
      );
      btnEl.setAttribute('data-option-index', String(optIdx));
      btnEl.addEventListener('click', (event: Event) => {
        event.stopPropagation();
        this.selectOption(optIdx);
      });

      btnEl.appendChild(
        createQuizTroikaText({
          position: `${-optW / 2 + 0.022} 0 0.004`,
          value: fullText,
          color: textColor,
          fontSize: 0.014,
          maxWidth: optW - 0.044,
          align: 'left',
          anchor: 'left',
          baseline: 'center',
        }),
      );
      this.rootGroupEl.appendChild(btnEl);
    });

    // bloco explicativo diretamente abaixo das alternativas (seção 2.2 e 4)
    if (answer && expH > 0) {
      currentY -= 0.004;
      const expY = currentY - expH / 2;
      currentY -= expH + 0.018;

      const expBorderColor = answer.isCorrect ? '#10B981' : '#EA580C';
      const expBgColor = isLight
        ? answer.isCorrect
          ? '#F0FDF4'
          : '#FFF7ED'
        : answer.isCorrect
          ? '#022C22'
          : '#431407';
      const expTextColor = isLight
        ? answer.isCorrect
          ? '#15803D'
          : '#C2410C'
        : answer.isCorrect
          ? '#86EFAC'
          : '#FDBA74';

      const expBorderEl = document.createElement('a-plane') as Entity;
      expBorderEl.setAttribute('width', String(optW + 0.004));
      expBorderEl.setAttribute('height', String(expH + 0.004));
      expBorderEl.setAttribute('position', `0 ${expY} 0`);
      expBorderEl.setAttribute(
        'material',
        `shader: flat; color: ${expBorderColor}; opacity: 0.95; transparent: true`,
      );
      this.rootGroupEl.appendChild(expBorderEl);

      const expBoxEl = document.createElement('a-plane') as Entity;
      expBoxEl.setAttribute('width', String(optW));
      expBoxEl.setAttribute('height', String(expH));
      expBoxEl.setAttribute('position', `0 ${expY} 0.002`);
      expBoxEl.setAttribute(
        'material',
        `shader: flat; color: ${expBgColor}; opacity: 0.95; transparent: true`,
      );
      expBoxEl.appendChild(
        createQuizTroikaText({
          position: `${-optW / 2 + 0.02} 0 0.004`,
          value: fullExpText,
          color: expTextColor,
          fontSize: 0.013,
          maxWidth: optW - 0.04,
          align: 'left',
          anchor: 'left',
          baseline: 'center',
        }),
      );
      this.rootGroupEl.appendChild(expBoxEl);
    }

    // botões de navegação posicionados no fluxo vertical natural (sem clamping rígido que causa sobreposição)
    currentY -= 0.006;
    const navY = currentY - navH / 2;

    const prevBtn = document.createElement('a-plane') as Entity;
    prevBtn.classList.add('interactable');
    prevBtn.setAttribute('width', '0.2');
    prevBtn.setAttribute('height', '0.044');
    prevBtn.setAttribute('position', `-0.18 ${navY} 0.004`);
    prevBtn.setAttribute(
      'material',
      `shader: flat; color: ${isLight ? '#F1F5F9' : '#1F2025'}; opacity: 0.96; transparent: true`,
    );
    prevBtn.addEventListener('click', (event: Event) => {
      event.stopPropagation();
      this.quizController?.prevQuestion();
      this.renderCurrentQuestion();
    });
    prevBtn.appendChild(
      createPhosphorIconEntity({
        icon: 'caret-left',
        color: palette.buttonTextColor,
        size: 0.018,
        position: '-0.065 0 0.004',
      }),
    );
    prevBtn.appendChild(
      createQuizTroikaText({
        position: '0.012 0 0.004',
        value: 'Anterior',
        color: palette.buttonTextColor,
        fontSize: 0.014,
        maxWidth: 0.14,
        align: 'center',
        anchor: 'center',
        baseline: 'center',
      }),
    );
    this.rootGroupEl.appendChild(prevBtn);

    const nextBtn = document.createElement('a-plane') as Entity;
    nextBtn.classList.add('interactable');
    nextBtn.setAttribute('width', '0.24');
    nextBtn.setAttribute('height', '0.044');
    nextBtn.setAttribute('position', `0.16 ${navY} 0.004`);
    nextBtn.setAttribute(
      'material',
      'shader: flat; color: #EA580C; opacity: 0.96; transparent: true',
    );
    nextBtn.addEventListener('click', (event: Event) => {
      event.stopPropagation();
      this.quizController?.advanceToNextUnanswered();
      this.renderCurrentQuestion();
    });
    nextBtn.appendChild(
      createPhosphorIconEntity({
        icon: 'caret-right',
        color: '#121316',
        size: 0.018,
        position: '0.08 0 0.004',
      }),
    );
    nextBtn.appendChild(
      createQuizTroikaText({
        position: '-0.01 0 0.004',
        value: 'Próxima pergunta',
        color: '#121316',
        fontSize: 0.013,
        maxWidth: 0.17,
        align: 'center',
        anchor: 'center',
        baseline: 'center',
      }),
    );
    this.rootGroupEl.appendChild(nextBtn);

    const page = current.anchors[0]?.page ?? 1;
    const citation = formatCardCitation(this.data.sourceTitle || 'Material de estudo', page);
    this.el.setAttribute('imx-panel', 'footer', citation);
  }
}

AFRAME.registerComponent<QuizPanelComponent>('imx-quiz-panel', {
  dependencies: ['imx-panel'],
  schema: {
    quizId: { type: 'string', default: '' },
    sourceTitle: { type: 'string', default: 'Material de estudo' },
  },
  init() {
    this.controller = new QuizPanelBridge(this.el, this.data);
  },
  update() {
    this.controller?.updateData(this.data);
  },
  remove() {
    this.controller?.dispose();
  },
});
