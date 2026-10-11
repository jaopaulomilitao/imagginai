import copy
import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.core.config import REPO_ROOT
from app.schemas.study_pack import ConceptGraphAsset, SequenceOrderAsset, parse_study_pack

FIXTURES_DIR = REPO_ROOT / "fixtures"
DEMO_PACK_PATH = FIXTURES_DIR / "demo-pack.json"
INVALID_CASES: list[dict[str, Any]] = json.loads(
    (FIXTURES_DIR / "study-pack-invalid-cases.json").read_text(encoding="utf-8")
)


def _load_demo_pack() -> dict[str, Any]:
    return json.loads(Path(DEMO_PACK_PATH).read_text(encoding="utf-8"))


def _apply_case(pack: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    mutated = copy.deepcopy(pack)
    *parent_path, last_key = case["path"]
    parent: Any = mutated
    for key in parent_path:
        parent = parent[key]
    if case.get("remove"):
        del parent[last_key]
    else:
        parent[last_key] = case["value"]
    return mutated


def test_demo_pack_is_valid() -> None:
    pack = parse_study_pack(DEMO_PACK_PATH.read_bytes())

    assert pack.pack_id == "pack-demo-cardio-v1"


def test_demo_pack_matches_phase_one_content_requirements() -> None:
    pack = parse_study_pack(DEMO_PACK_PATH.read_bytes())

    assert len(pack.concepts) == 12
    assert len(pack.quiz) == 8
    assert sum(isinstance(asset, ConceptGraphAsset) for asset in pack.assets) == 1
    assert sum(isinstance(asset, SequenceOrderAsset) for asset in pack.assets) == 1


def test_demo_pack_round_trips_with_camel_case_keys() -> None:
    raw = _load_demo_pack()
    pack = parse_study_pack(json.dumps(raw))

    assert pack.model_dump(mode="json") == raw


@pytest.mark.parametrize("case", INVALID_CASES, ids=[case["name"] for case in INVALID_CASES])
def test_invalid_pack_is_rejected(case: dict[str, Any]) -> None:
    mutated = _apply_case(_load_demo_pack(), case)

    with pytest.raises(ValidationError):
        parse_study_pack(json.dumps(mutated))
