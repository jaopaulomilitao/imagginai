// máquina de estados e formatação de apresentação para flashcards espaciais interativos
import { PT_BR } from '../../shared/i18n/pt-br';

export interface FlashcardViewData {
  title: string;
  body: string;
  sourceTitle: string;
  sourcePage: number;
  accentColor?: string;
}

export function formatCardCitation(sourceTitle: string, sourcePage: number): string {
  const shortTitle =
    sourceTitle.length > 34 ? `${sourceTitle.slice(0, 31).trimEnd()}...` : sourceTitle;
  return `${shortTitle} | ${PT_BR.zone.panels.sourceCitationPrefix} ${sourcePage}`;
}

export class FlashcardStateMachine {
  private revealed = false;

  constructor(private data: FlashcardViewData) {}

  get isRevealed(): boolean {
    return this.revealed;
  }

  update(data: FlashcardViewData): void {
    this.data = data;
  }

  toggle(): boolean {
    this.revealed = !this.revealed;
    return this.revealed;
  }

  reveal(): void {
    this.revealed = true;
  }

  hide(): void {
    this.revealed = false;
  }

  getBadgeText(): string {
    if (this.revealed) {
      return this.data.title.length > 40
        ? `${this.data.title.slice(0, 38).trimEnd()}..`
        : this.data.title;
    }
    return PT_BR.zone.panels.flashcardBadge ?? 'FLASHCARD';
  }

  getCenterText(): string {
    if (this.revealed) {
      return this.data.body || 'Sem descrição cadastrada.';
    }
    return this.data.title;
  }

  getButtonLabel(): string {
    if (this.revealed) {
      return PT_BR.zone.panels.flashcardHide ?? 'Ocultar';
    }
    return PT_BR.zone.panels.flashcardReveal ?? 'Revelar';
  }

  getCitation(): string {
    return this.data.sourceTitle
      ? formatCardCitation(this.data.sourceTitle, this.data.sourcePage)
      : '';
  }
}
