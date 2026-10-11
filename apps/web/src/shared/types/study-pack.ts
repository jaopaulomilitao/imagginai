// espelho exato de apps/api/app/schemas/study_pack.py (seção 3.6.2)

export interface SourceAnchor {
  sourceId: string;
  page: number;
  chunkId: string;
}

export interface ConceptNode {
  id: string;
  label: string;
  definition: string;
  anchors: SourceAnchor[];
  position: [number, number, number];
}

export interface ConceptEdge {
  sourceId: string;
  targetId: string;
  relation: string;
  anchors: SourceAnchor[];
}

export interface StudyCard {
  id: string;
  title: string;
  body: string;
  conceptIds: string[];
  anchors: SourceAnchor[];
}

export interface QuizItem {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  conceptIds: string[];
  anchors: SourceAnchor[];
}

export interface SequenceStep {
  id: string;
  text: string;
  anchors: SourceAnchor[];
}

export interface ConceptGraphAsset {
  id: string;
  kind: 'concept-graph';
  title: string;
  whySpatial: string;
  nodeIds: string[];
}

export interface SequenceOrderAsset {
  id: string;
  kind: 'sequence-order';
  title: string;
  whySpatial: string;
  // os passos são armazenados na ordem correta; o embaralhamento ocorre apenas na zona
  steps: SequenceStep[];
}

export type LearningAsset = ConceptGraphAsset | SequenceOrderAsset;

export interface PackSource {
  id: string;
  title: string;
  pageCount: number;
}

export interface StudyPackMeta {
  generatedAt: string;
  promptVersion: string;
  model: string;
  discarded: number;
}

export interface StudyPack {
  schemaVersion: '1.0';
  packId: string;
  zoneId: string;
  sources: PackSource[];
  concepts: ConceptNode[];
  edges: ConceptEdge[];
  cards: StudyCard[];
  quiz: QuizItem[];
  assets: LearningAsset[];
  meta: StudyPackMeta;
}
