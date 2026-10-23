"""cálculo determinístico de layout 3d para o grafo de conceitos via networkx."""

from collections.abc import Sequence

import networkx as nx

from app.core.config import (
    GRAPH_LAYOUT_DIM,
    GRAPH_LAYOUT_SEED,
    POSITION_MAX,
    POSITION_MIN,
)


def _normalize_axis(values: list[float]) -> list[float]:
    # reescala os valores de um eixo para o intervalo [-1.0, 1.0] evitando divisão por zero
    if not values:
        return []
    min_val = min(values)
    max_val = max(values)
    span = max_val - min_val
    if span <= 1e-9:
        return [0.0 for _ in values]
    scaled = [POSITION_MIN + ((v - min_val) / span) * (POSITION_MAX - POSITION_MIN) for v in values]
    return [max(POSITION_MIN, min(POSITION_MAX, round(float(v), 4))) for v in scaled]


def compute_concept_positions(
    concept_ids: Sequence[str],
    edges: Sequence[tuple[str, str]],
    *,
    seed: int = GRAPH_LAYOUT_SEED,
) -> dict[str, tuple[float, float, float]]:
    """calcula posições tridimensionais normalizadas em [-1, 1] com semente fixa 42."""
    if not concept_ids:
        return {}
    if len(concept_ids) == 1:
        return {concept_ids[0]: (0.0, 0.0, 0.0)}

    graph = nx.Graph()
    for node_id in concept_ids:
        graph.add_node(node_id)
    for source_id, target_id in edges:
        if source_id in graph and target_id in graph:
            graph.add_edge(source_id, target_id)

    raw_positions = nx.spring_layout(graph, dim=GRAPH_LAYOUT_DIM, seed=seed)
    xs = [float(raw_positions[node_id][0]) for node_id in concept_ids]
    ys = [float(raw_positions[node_id][1]) for node_id in concept_ids]
    zs = [float(raw_positions[node_id][2]) for node_id in concept_ids]

    norm_x = _normalize_axis(xs)
    norm_y = _normalize_axis(ys)
    norm_z = _normalize_axis(zs)

    return {
        node_id: (norm_x[idx], norm_y[idx], norm_z[idx]) for idx, node_id in enumerate(concept_ids)
    }
