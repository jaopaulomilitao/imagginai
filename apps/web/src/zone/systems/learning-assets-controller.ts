import type {
  ConceptEdge,
  ConceptGraphAsset,
  ConceptNode,
  QuizItem,
  SequenceOrderAsset,
  SequenceStep,
  SourceAnchor,
  StudyCard,
} from '../../shared/types/study-pack';

export const CONCEPT_GRAPH_VOLUME_HALF_WIDTH_M = 0.34;
export const CONCEPT_GRAPH_VOLUME_HALF_HEIGHT_M = 0.2;
export const CONCEPT_GRAPH_VOLUME_HALF_DEPTH_M = 0.1;

export interface ScaledGraphNode {
  readonly conceptId: string;
  readonly label: string;
  readonly definition: string;
  readonly anchors: readonly SourceAnchor[];
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ScaledGraphEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly relation: string;
  readonly fromPos: { readonly x: number; readonly y: number; readonly z: number };
  readonly toPos: { readonly x: number; readonly y: number; readonly z: number };
}

export interface ConceptNodeSelection {
  readonly node: ScaledGraphNode;
  readonly connectedEdges: readonly ScaledGraphEdge[];
  readonly card: StudyCard;
}

// controlador puro do grafo de conceitos 3d em volume espacial de ~0.8 m (seção 3.6.3)
export class ConceptGraphController {
  readonly nodes: readonly ScaledGraphNode[];
  readonly edges: readonly ScaledGraphEdge[];
  private selectedConceptId: string | null = null;

  constructor(
    readonly asset: ConceptGraphAsset,
    concepts: readonly ConceptNode[],
    edges: readonly ConceptEdge[],
  ) {
    const conceptMap = new Map<string, ConceptNode>();
    for (const concept of concepts) {
      conceptMap.set(concept.id, concept);
    }

    const scaledNodes: ScaledGraphNode[] = [];
    const nodePosMap = new Map<string, { x: number; y: number; z: number }>();

    const targetIds = asset.nodeIds.length > 0 ? asset.nodeIds : concepts.map((c) => c.id);

    for (const nodeId of targetIds) {
      const concept = conceptMap.get(nodeId);
      if (!concept) continue;
      const [nx, ny, nz] = concept.position;
      const x = Math.round(nx * CONCEPT_GRAPH_VOLUME_HALF_WIDTH_M * 1000) / 1000;
      const y = Math.round(ny * CONCEPT_GRAPH_VOLUME_HALF_HEIGHT_M * 1000) / 1000;
      const z = Math.round(nz * CONCEPT_GRAPH_VOLUME_HALF_DEPTH_M * 1000) / 1000;
      const scaled: ScaledGraphNode = {
        conceptId: concept.id,
        label: concept.label,
        definition: concept.definition,
        anchors: concept.anchors,
        x,
        y,
        z,
      };
      scaledNodes.push(scaled);
      nodePosMap.set(concept.id, { x, y, z });
    }

    const scaledEdges: ScaledGraphEdge[] = [];
    for (const edge of edges) {
      const fromPos = nodePosMap.get(edge.sourceId);
      const toPos = nodePosMap.get(edge.targetId);
      if (!fromPos || !toPos) continue;
      scaledEdges.push({
        fromId: edge.sourceId,
        toId: edge.targetId,
        relation: edge.relation,
        fromPos,
        toPos,
      });
    }

    this.nodes = scaledNodes;
    this.edges = scaledEdges;
    this.selectedConceptId = scaledNodes[0]?.conceptId ?? null;
  }

  getSelectedConceptId(): string | null {
    return this.selectedConceptId;
  }

  selectNode(conceptId: string): ConceptNodeSelection | null {
    const node = this.nodes.find((item) => item.conceptId === conceptId);
    if (!node) return null;
    this.selectedConceptId = conceptId;

    const connectedEdges = this.edges.filter(
      (edge) => edge.fromId === conceptId || edge.toId === conceptId,
    );
    const relationsSummary =
      connectedEdges.length > 0
        ? `\n\nRelações: ${connectedEdges
            .map((edge) => {
              const otherId = edge.fromId === conceptId ? edge.toId : edge.fromId;
              const otherNode = this.nodes.find((n) => n.conceptId === otherId);
              return `${edge.relation} -> ${otherNode?.label ?? otherId}`;
            })
            .join(' | ')}`
        : '';

    const card: StudyCard = {
      id: `graph-concept-${node.conceptId}`,
      title: node.label,
      body: `${node.definition}${relationsSummary}`,
      conceptIds: [node.conceptId],
      anchors: [...node.anchors],
    };

    return {
      node,
      connectedEdges,
      card,
    };
  }
}

export interface SequenceCheckResult {
  readonly isCorrect: boolean;
  readonly correctSlotsCount: number;
  readonly totalSteps: number;
  readonly attempts: number;
  readonly orderedSteps: readonly SequenceStep[];
  readonly anchors: readonly SourceAnchor[];
}

// embaralha de forma determinística os passos garantindo que não iniciem já ordenados
export function deterministicShuffleSteps(steps: readonly SequenceStep[]): SequenceStep[] {
  if (steps.length <= 1) return [...steps];
  const copy = [...steps];
  for (let i = copy.length - 1; i > 0; i--) {
    const swapIdx = (i * 7 + 3) % (i + 1);
    const temp = copy[i];
    const target = copy[swapIdx];
    if (temp && target) {
      copy[i] = target;
      copy[swapIdx] = temp;
    }
  }
  const stillSorted = copy.every((step, idx) => step.id === steps[idx]?.id);
  if (stillSorted && copy.length >= 2) {
    const first = copy[0];
    const last = copy[copy.length - 1];
    if (first && last) {
      copy[0] = last;
      copy[copy.length - 1] = first;
    }
  }
  return copy;
}

// controlador puro do objeto de estudo sequence-order com seleção/arraste para slots e verificação (seção 3.6.3)
export class SequenceOrderController {
  readonly targetSteps: readonly SequenceStep[];
  private currentSlots: SequenceStep[];
  private activeSlotIndex: number | null = null;
  private attempts = 0;
  private lastResult: SequenceCheckResult | null = null;

  constructor(readonly asset: SequenceOrderAsset) {
    this.targetSteps = [...asset.steps];
    this.currentSlots = deterministicShuffleSteps(asset.steps);
  }

  getSlots(): readonly SequenceStep[] {
    return [...this.currentSlots];
  }

  getActiveSlotIndex(): number | null {
    return this.activeSlotIndex;
  }

  getAttempts(): number {
    return this.attempts;
  }

  getLastResult(): SequenceCheckResult | null {
    return this.lastResult;
  }

  // seleciona um slot ou troca dois slots quando o usuário faz pinch-drag / clique sequencial entre cartões e slots
  interactWithSlot(slotIndex: number): void {
    if (slotIndex < 0 || slotIndex >= this.currentSlots.length) return;
    if (this.activeSlotIndex === null) {
      this.activeSlotIndex = slotIndex;
      return;
    }
    if (this.activeSlotIndex === slotIndex) {
      this.activeSlotIndex = null;
      return;
    }
    this.swapSlots(this.activeSlotIndex, slotIndex);
    this.activeSlotIndex = null;
  }

  swapSlots(indexA: number, indexB: number): void {
    if (
      indexA < 0 ||
      indexB < 0 ||
      indexA >= this.currentSlots.length ||
      indexB >= this.currentSlots.length
    ) {
      return;
    }
    const itemA = this.currentSlots[indexA];
    const itemB = this.currentSlots[indexB];
    if (!itemA || !itemB) return;
    this.currentSlots[indexA] = itemB;
    this.currentSlots[indexB] = itemA;
    this.lastResult = null;
  }

  resetShuffle(): void {
    this.currentSlots = deterministicShuffleSteps(this.targetSteps);
    this.activeSlotIndex = null;
    this.lastResult = null;
  }

  checkOrder(): SequenceCheckResult {
    this.attempts += 1;
    let correctSlotsCount = 0;
    const anchors: SourceAnchor[] = [];

    this.currentSlots.forEach((step, idx) => {
      if (step.id === this.targetSteps[idx]?.id) {
        correctSlotsCount += 1;
      }
      for (const anchor of step.anchors) {
        if (!anchors.some((a) => a.chunkId === anchor.chunkId && a.page === anchor.page)) {
          anchors.push(anchor);
        }
      }
    });

    const result: SequenceCheckResult = {
      isCorrect: correctSlotsCount === this.targetSteps.length,
      correctSlotsCount,
      totalSteps: this.targetSteps.length,
      attempts: this.attempts,
      orderedSteps: [...this.targetSteps],
      anchors,
    };
    this.lastResult = result;
    return result;
  }
}

export interface QuizAnswerFeedback {
  readonly questionId: string;
  readonly selectedIndex: number;
  readonly correctIndex: number;
  readonly isCorrect: boolean;
  readonly explanation: string;
  readonly conceptIds: readonly string[];
  readonly anchors: readonly SourceAnchor[];
}

// seleciona de 3 a 5 questões priorizando os conceitos menos visualizados na sessão (seção 5 fase 9)
export function selectPomodoroQuizItems(
  allItems: readonly QuizItem[],
  conceptOpens: Readonly<Record<string, number>>,
  desiredCount = 4,
): QuizItem[] {
  const clampedCount = Math.max(3, Math.min(5, desiredCount));
  if (allItems.length <= clampedCount) {
    return [...allItems];
  }

  const scored = allItems.map((item, originalIndex) => {
    const avgOpens =
      item.conceptIds.length > 0
        ? item.conceptIds.reduce((sum, cid) => sum + (conceptOpens[cid] ?? 0), 0) /
          item.conceptIds.length
        : 0;
    return {
      item,
      avgOpens,
      originalIndex,
    };
  });

  scored.sort((a, b) => {
    if (a.avgOpens !== b.avgOpens) {
      return a.avgOpens - b.avgOpens;
    }
    return a.originalIndex - b.originalIndex;
  });

  return scored.slice(0, clampedCount).map((entry) => entry.item);
}

// controlador puro do painel interativo de quiz com feedback imediato e citação da fonte
export class QuizSessionController {
  private readonly items: readonly QuizItem[];
  private currentIndex = 0;
  private readonly answers = new Map<string, QuizAnswerFeedback>();

  constructor(items: readonly QuizItem[]) {
    this.items = items.length > 0 ? [...items] : [];
  }

  getTotalQuestions(): number {
    return this.items.length;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getCurrentQuestion(): QuizItem | null {
    return this.items[this.currentIndex] ?? null;
  }

  getAnswerForCurrent(): QuizAnswerFeedback | null {
    const current = this.getCurrentQuestion();
    if (!current) return null;
    return this.answers.get(current.id) ?? null;
  }

  isQuestionAnswered(questionId: string): boolean {
    if (this.answers.has(questionId)) return true;
    const item = this.items.find((q) => q.id === questionId);
    return Boolean(item?.answered);
  }

  submitAnswer(optionIndex: number): QuizAnswerFeedback | null {
    const current = this.getCurrentQuestion();
    if (!current) return null;
    if (optionIndex < 0 || optionIndex >= current.options.length) return null;

    current.answered = true;
    const feedback: QuizAnswerFeedback = {
      questionId: current.id,
      selectedIndex: optionIndex,
      correctIndex: current.correctIndex,
      isCorrect: optionIndex === current.correctIndex,
      explanation: current.explanation,
      conceptIds: [...current.conceptIds],
      anchors: [...current.anchors],
    };
    this.answers.set(current.id, feedback);
    return feedback;
  }

  advanceToNextUnanswered(): QuizItem | null {
    if (this.items.length === 0) return null;
    for (let offset = 1; offset <= this.items.length; offset++) {
      const idx = (this.currentIndex + offset) % this.items.length;
      const candidate = this.items[idx];
      if (candidate && !this.isQuestionAnswered(candidate.id)) {
        this.currentIndex = idx;
        return candidate;
      }
    }
    return this.nextQuestion();
  }

  nextQuestion(): QuizItem | null {
    if (this.items.length === 0) return null;
    this.currentIndex = (this.currentIndex + 1) % this.items.length;
    return this.getCurrentQuestion();
  }

  prevQuestion(): QuizItem | null {
    if (this.items.length === 0) return null;
    this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
    return this.getCurrentQuestion();
  }

  getScoreSummary(): { answered: number; correct: number; total: number } {
    let correct = 0;
    for (const ans of this.answers.values()) {
      if (ans.isCorrect) correct += 1;
    }
    return {
      answered: this.answers.size,
      correct,
      total: this.items.length,
    };
  }
}
