"""verificação de grounding por existência de chunk_id e similaridade de cosseno >= 0.70."""

import math
from collections.abc import Sequence
from dataclasses import dataclass

from app.core.config import (
    CONCEPT_DEFINITION_MAX_LENGTH,
    CONCEPT_LABEL_MAX_LENGTH,
    GROUNDING_MIN_SIMILARITY,
    PACK_CONCEPTS_MAX,
    PACK_QUIZ_MAX,
    PACK_SEQUENCE_ASSETS_MAX,
    QUIZ_OPTION_COUNT,
)
from app.core.db import ChunkRecord
from app.prompts.study_pack_v1 import (
    ExtractedAnchor,
    ExtractedAsset,
    ExtractedCard,
    ExtractedConcept,
    ExtractedEdge,
    ExtractedQuizItem,
    RawStudyPackExtraction,
)
from app.schemas.study_pack import (
    ConceptEdge,
    ConceptGraphAsset,
    ConceptNode,
    LearningAsset,
    QuizItem,
    SequenceOrderAsset,
    SequenceStep,
    SourceAnchor,
    StudyCard,
)
from app.services.embeddings import EmbeddingClient
from app.services.layout import compute_concept_positions


@dataclass(frozen=True)
class GroundedExtractionResult:
    """itens validados pelo grounding prontos para montagem do study pack."""

    concepts: list[ConceptNode]
    edges: list[ConceptEdge]
    cards: list[StudyCard]
    quiz: list[QuizItem]
    assets: list[LearningAsset]
    discarded: int


def cosine_similarity(vec_a: Sequence[float], vec_b: Sequence[float]) -> float:
    """calcula a similaridade de cosseno entre dois vetores de mesma dimensão."""
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b, strict=True))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a <= 1e-12 or norm_b <= 1e-12:
        return 0.0
    return float(dot / (norm_a * norm_b))


def _resolve_valid_anchors(
    raw_anchors: Sequence[ExtractedAnchor],
    chunk_by_id: dict[str, ChunkRecord],
) -> list[SourceAnchor]:
    # retém apenas âncoras cujo chunk_id exista e coincida com a fonte e página reais
    valid: list[SourceAnchor] = []
    seen: set[str] = set()
    for raw in raw_anchors:
        chunk = chunk_by_id.get(raw.chunk_id)
        if chunk is None:
            continue
        if raw.source_id != chunk.source_id or raw.page != chunk.page:
            continue
        if chunk.id not in seen:
            seen.add(chunk.id)
            valid.append(
                SourceAnchor(
                    source_id=chunk.source_id,
                    page=chunk.page,
                    chunk_id=chunk.id,
                )
            )
    return valid


def _is_grounded(
    item_embedding: Sequence[float],
    anchors: Sequence[SourceAnchor],
    chunk_by_id: dict[str, ChunkRecord],
    min_similarity: float,
) -> bool:
    if not anchors:
        return False
    best = max(
        cosine_similarity(item_embedding, chunk_by_id[anchor.chunk_id].embedding)
        for anchor in anchors
        if anchor.chunk_id in chunk_by_id
    )
    return best >= min_similarity


def _filter_concepts(
    raw_concepts: Sequence[ExtractedConcept],
    chunk_by_id: dict[str, ChunkRecord],
    embedding_client: EmbeddingClient,
    min_similarity: float,
) -> tuple[list[tuple[ExtractedConcept, list[SourceAnchor]]], int]:
    candidates: list[tuple[ExtractedConcept, list[SourceAnchor], str]] = []
    discarded = 0
    seen_ids: set[str] = set()

    for item in raw_concepts:
        cid = item.id.strip()
        label = item.label.strip()[:CONCEPT_LABEL_MAX_LENGTH]
        definition = item.definition.strip()[:CONCEPT_DEFINITION_MAX_LENGTH]
        anchors = _resolve_valid_anchors(item.anchors, chunk_by_id)
        if not cid or cid in seen_ids or not label or not definition or not anchors:
            discarded += 1
            continue
        seen_ids.add(cid)
        normalized = ExtractedConcept(
            id=cid,
            label=label,
            definition=definition,
            anchors=item.anchors,
        )
        candidates.append((normalized, anchors, f"{label}: {definition}"))

    if not candidates:
        return [], discarded

    embeddings = embedding_client.embed_texts([text for _, _, text in candidates])
    kept: list[tuple[ExtractedConcept, list[SourceAnchor]]] = []
    for (concept, anchors, _), vec in zip(candidates, embeddings, strict=True):
        if _is_grounded(vec, anchors, chunk_by_id, min_similarity):
            kept.append((concept, anchors))
        else:
            discarded += 1

    if len(kept) > PACK_CONCEPTS_MAX:
        kept = kept[:PACK_CONCEPTS_MAX]
    return kept, discarded


def _filter_edges(
    raw_edges: Sequence[ExtractedEdge],
    concept_by_id: dict[str, ExtractedConcept],
    chunk_by_id: dict[str, ChunkRecord],
    embedding_client: EmbeddingClient,
    min_similarity: float,
) -> tuple[list[ConceptEdge], int]:
    candidates: list[tuple[ExtractedEdge, list[SourceAnchor], str]] = []
    discarded = 0

    for edge in raw_edges:
        relation = edge.relation.strip()
        anchors = _resolve_valid_anchors(edge.anchors, chunk_by_id)
        src = concept_by_id.get(edge.source_id)
        dst = concept_by_id.get(edge.target_id)
        if src is None or dst is None or not relation or not anchors:
            discarded += 1
            continue
        edge_text = f"{src.label} ({src.definition}) {relation} {dst.label} ({dst.definition})"
        candidates.append((edge, anchors, edge_text))

    if not candidates:
        return [], discarded

    embeddings = embedding_client.embed_texts([text for _, _, text in candidates])
    kept: list[ConceptEdge] = []
    for (edge, anchors, relation), vec in zip(candidates, embeddings, strict=True):
        if _is_grounded(vec, anchors, chunk_by_id, min_similarity):
            kept.append(
                ConceptEdge(
                    source_id=edge.source_id,
                    target_id=edge.target_id,
                    relation=relation,
                    anchors=anchors,
                )
            )
        else:
            discarded += 1
    return kept, discarded


def _filter_cards(
    raw_cards: Sequence[ExtractedCard],
    valid_concept_ids: set[str],
    chunk_by_id: dict[str, ChunkRecord],
    embedding_client: EmbeddingClient,
    min_similarity: float,
) -> tuple[list[StudyCard], int]:
    candidates: list[tuple[ExtractedCard, list[str], list[SourceAnchor], str]] = []
    discarded = 0
    seen_ids: set[str] = set()

    for card in raw_cards:
        cid = card.id.strip()
        title = card.title.strip()
        body = card.body.strip()
        c_refs = [ref for ref in card.concept_ids if ref in valid_concept_ids]
        anchors = _resolve_valid_anchors(card.anchors, chunk_by_id)
        if not cid or cid in seen_ids or not title or not body or not c_refs or not anchors:
            discarded += 1
            continue
        seen_ids.add(cid)
        candidates.append((card, c_refs, anchors, f"{title}: {body}"))

    if not candidates:
        return [], discarded

    embeddings = embedding_client.embed_texts([text for _, _, _, text in candidates])
    kept: list[StudyCard] = []
    for (card, c_refs, anchors, _), vec in zip(candidates, embeddings, strict=True):
        if _is_grounded(vec, anchors, chunk_by_id, min_similarity):
            kept.append(
                StudyCard(
                    id=card.id.strip(),
                    title=card.title.strip(),
                    body=card.body.strip(),
                    concept_ids=c_refs,
                    anchors=anchors,
                )
            )
        else:
            discarded += 1
    return kept, discarded


def _filter_quiz(
    raw_quiz: Sequence[ExtractedQuizItem],
    valid_concept_ids: set[str],
    chunk_by_id: dict[str, ChunkRecord],
    embedding_client: EmbeddingClient,
    min_similarity: float,
) -> tuple[list[QuizItem], int]:
    candidates: list[tuple[ExtractedQuizItem, list[str], list[SourceAnchor], str]] = []
    discarded = 0
    seen_ids: set[str] = set()

    for item in raw_quiz:
        qid = item.id.strip()
        prompt = item.prompt.strip()
        explanation = item.explanation.strip()
        options = [opt.strip() for opt in item.options if opt.strip()]
        c_refs = [ref for ref in item.concept_ids if ref in valid_concept_ids]
        anchors = _resolve_valid_anchors(item.anchors, chunk_by_id)
        if (
            not qid
            or qid in seen_ids
            or not prompt
            or not explanation
            or len(options) != QUIZ_OPTION_COUNT
            or not (0 <= item.correct_index < QUIZ_OPTION_COUNT)
            or not c_refs
            or not anchors
        ):
            discarded += 1
            continue
        seen_ids.add(qid)
        correct_opt = options[item.correct_index]
        text = f"{prompt} {correct_opt} {explanation}"
        normalized = ExtractedQuizItem(
            id=qid,
            prompt=prompt,
            options=options,
            correct_index=item.correct_index,
            explanation=explanation,
            concept_ids=c_refs,
            anchors=item.anchors,
        )
        candidates.append((normalized, c_refs, anchors, text))

    if not candidates:
        return [], discarded

    embeddings = embedding_client.embed_texts([text for _, _, _, text in candidates])
    kept: list[QuizItem] = []
    for (item, c_refs, anchors, _), vec in zip(candidates, embeddings, strict=True):
        if _is_grounded(vec, anchors, chunk_by_id, min_similarity):
            kept.append(
                QuizItem(
                    id=item.id,
                    prompt=item.prompt,
                    options=item.options,
                    correct_index=item.correct_index,
                    explanation=item.explanation,
                    concept_ids=c_refs,
                    anchors=anchors,
                )
            )
        else:
            discarded += 1

    if len(kept) > PACK_QUIZ_MAX:
        kept = kept[:PACK_QUIZ_MAX]
    return kept, discarded


def _filter_assets_and_fallback_cards(
    raw_assets: Sequence[ExtractedAsset],
    valid_concept_ids: list[str],
    existing_card_ids: set[str],
    chunk_by_id: dict[str, ChunkRecord],
    embedding_client: EmbeddingClient,
    min_similarity: float,
) -> tuple[list[LearningAsset], list[StudyCard], int]:
    # converte ativos sem whySpatial em cartões de estudo conforme a seção 3.6.3
    concept_set = set(valid_concept_ids)
    kept_assets: list[LearningAsset] = []
    fallback_cards: list[StudyCard] = []
    discarded = 0
    seen_asset_ids: set[str] = set()
    sequence_count = 0

    for asset in raw_assets:
        aid = asset.id.strip()
        title = asset.title.strip()
        why_spatial = asset.why_spatial.strip()
        if not aid or aid in seen_asset_ids or not title:
            discarded += 1
            continue

        if asset.kind == "concept-graph":
            nodes = [nid for nid in asset.node_ids if nid in concept_set] or list(valid_concept_ids)
            if not why_spatial or not nodes:
                discarded += 1
                continue
            seen_asset_ids.add(aid)
            kept_assets.append(
                ConceptGraphAsset(
                    id=aid,
                    kind="concept-graph",
                    title=title,
                    why_spatial=why_spatial,
                    node_ids=nodes,
                )
            )
            continue

        # valida cada passo de um ativo sequence-order contra os chunks citados
        step_candidates: list[tuple[str, str, list[SourceAnchor]]] = []
        seen_step_ids: set[str] = set()
        for step in asset.steps:
            sid = step.id.strip()
            stext = step.text.strip()
            s_anchors = _resolve_valid_anchors(step.anchors, chunk_by_id)
            if not sid or sid in seen_step_ids or not stext or not s_anchors:
                discarded += 1
                continue
            seen_step_ids.add(sid)
            step_candidates.append((sid, stext, s_anchors))

        if len(step_candidates) < 2:
            discarded += 1
            continue

        step_embeddings = embedding_client.embed_texts([stext for _, stext, _ in step_candidates])
        grounded_steps: list[SequenceStep] = []
        for (sid, stext, s_anchors), vec in zip(step_candidates, step_embeddings, strict=True):
            if _is_grounded(vec, s_anchors, chunk_by_id, min_similarity):
                grounded_steps.append(SequenceStep(id=sid, text=stext, anchors=s_anchors))
            else:
                discarded += 1

        if len(grounded_steps) < 2:
            discarded += 1
            continue

        if not why_spatial:
            # sem justificativa espacial o ativo é descartado e vira um cartão (seção 3.6.3)
            discarded += 1
            card_id = f"card-from-{aid}"
            if card_id not in existing_card_ids and valid_concept_ids:
                existing_card_ids.add(card_id)
                merged_anchors = grounded_steps[0].anchors
                body_lines = [f"{idx + 1}. {s.text}" for idx, s in enumerate(grounded_steps)]
                fallback_cards.append(
                    StudyCard(
                        id=card_id,
                        title=title,
                        body=" ".join(body_lines),
                        concept_ids=[valid_concept_ids[0]],
                        anchors=merged_anchors,
                    )
                )
            continue

        if sequence_count >= PACK_SEQUENCE_ASSETS_MAX:
            continue
        seen_asset_ids.add(aid)
        sequence_count += 1
        kept_assets.append(
            SequenceOrderAsset(
                id=aid,
                kind="sequence-order",
                title=title,
                why_spatial=why_spatial,
                steps=grounded_steps,
            )
        )

    return kept_assets, fallback_cards, discarded


def verify_and_ground_extraction(
    extraction: RawStudyPackExtraction,
    chunks: Sequence[ChunkRecord],
    embedding_client: EmbeddingClient,
    *,
    min_similarity: float = GROUNDING_MIN_SIMILARITY,
) -> GroundedExtractionResult:
    """aplica as regras obrigatórias de grounding e calcula o layout 3d dos conceitos."""
    chunk_by_id = {chunk.id: chunk for chunk in chunks}

    kept_concepts_raw, disc_concepts = _filter_concepts(
        extraction.concepts,
        chunk_by_id,
        embedding_client,
        min_similarity,
    )
    valid_concept_ids = [concept.id for concept, _ in kept_concepts_raw]
    valid_concept_set = set(valid_concept_ids)
    concept_by_id = {concept.id: concept for concept, _ in kept_concepts_raw}

    edges, disc_edges = _filter_edges(
        extraction.edges,
        concept_by_id,
        chunk_by_id,
        embedding_client,
        min_similarity,
    )

    positions = compute_concept_positions(
        valid_concept_ids,
        [(edge.source_id, edge.target_id) for edge in edges],
    )
    concepts = [
        ConceptNode(
            id=concept.id,
            label=concept.label,
            definition=concept.definition,
            anchors=anchors,
            position=positions.get(concept.id, (0.0, 0.0, 0.0)),
        )
        for concept, anchors in kept_concepts_raw
    ]

    cards, disc_cards = _filter_cards(
        extraction.cards,
        valid_concept_set,
        chunk_by_id,
        embedding_client,
        min_similarity,
    )
    quiz, disc_quiz = _filter_quiz(
        extraction.quiz,
        valid_concept_set,
        chunk_by_id,
        embedding_client,
        min_similarity,
    )

    existing_card_ids = {card.id for card in cards}
    assets, fallback_cards, disc_assets = _filter_assets_and_fallback_cards(
        extraction.assets,
        valid_concept_ids,
        existing_card_ids,
        chunk_by_id,
        embedding_client,
        min_similarity,
    )
    cards.extend(fallback_cards)

    total_discarded = disc_concepts + disc_edges + disc_cards + disc_quiz + disc_assets
    return GroundedExtractionResult(
        concepts=concepts,
        edges=edges,
        cards=cards,
        quiz=quiz,
        assets=assets,
        discarded=total_discarded,
    )
