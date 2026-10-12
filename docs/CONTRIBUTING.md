# Contributing and Implementation Standards — IMAGGINAI

**Navigation:** [Root README (EN)](../README.md) | [README (pt-BR)](README.pt-BR.md) | [System Architecture](ARCHITECTURE.md) | [Specification](spec.md) | [Progress Log](PROGRESS.md)

This guide defines the mandatory coding conventions, architectural patterns, and concrete implementation examples for contributors working on IMAGGINAI. All rules below are enforced by automated linters (`pnpm lint`) and code review.

---

## 1. Workflow with `docs/spec.md` and `docs/PROGRESS.md`

Before writing code, contributors must check two files:

1. **[`docs/spec.md`](spec.md):** Verify the exact schema, constant value, route signature, and phase scope. Do not add third-party dependencies outside Section 2 of `spec.md` without documenting the justification in `docs/PROGRESS.md` and obtaining team approval.
2. **[`docs/PROGRESS.md`](PROGRESS.md):** Check the `Current status` and `Decisions` sections to understand active constraints and completed tasks. After finishing a feature or fix, update `docs/PROGRESS.md` with what was completed, any technical decisions made, and the test count.

---

## 2. Language and Comment Formatting Rules (Mandatory)

### 2.1 Identifiers (Always English)

All code identifiers across the repository must be written in English:

| Element                                     | Convention                        | Example                                          |
| :------------------------------------------ | :-------------------------------- | :----------------------------------------------- |
| Files and directories (Web / InteracXR)     | `kebab-case`                      | `theme-controller.ts`, `imx-belt-menu.ts`        |
| Files and modules (Python API)              | `snake_case`                      | `study_pack.py`, `test_phase6_backend.py`        |
| Classes, Interfaces, Types, Pydantic Models | `PascalCase`                      | `PoseClassifier`, `SourceAnchor`, `ZoneResponse` |
| Functions and variables (TypeScript)        | `camelCase`                       | `sphericalToCartesian`, `panelFacingPitchDeg`    |
| Functions and variables (Python)            | `snake_case`                      | `extract_pdf_pages`, `verify_supabase_jwt`       |
| Constants                                   | `UPPER_SNAKE_CASE`                | `CHUNK_TARGET_TOKENS`, `BELT_OPEN_PITCH_DEG`     |
| A-Frame components                          | `imx-*` (app) / `ixr-*` (library) | `imx-card-panel`, `ixr-hand-tracking`            |

### 2.2 Code Comments and Docstrings (Lowercase Impersonal Portuguese)

Every comment, JSDoc block, and Python docstring must follow four rules:

1. Written in **Portuguese**.
2. Written in **lowercase letters only** (including the very first letter of the sentence).
3. Written using **impersonal verb forms** (synthetic passive voice or third person: `"é calculado"`, `"verifica se"`, `"são descartados"`, `"garante que"`).
4. **Never** use first person (`"eu calculo"`, `"nós criamos"`, `"vamos validar"`) or second person (`"você deve passar"`). Comments must explain _why_ a decision or invariant exists, not restate the syntax.

#### TypeScript Comment Examples

```ts
// correto: português, letras minúsculas, verbo na forma impessoal explicando o motivo
// aplica janela deslizante mantendo apenas a página atual e as adjacentes na gpu
export function computePdfPageWindow(currentPage: number, totalPages: number): number[] {
  // ...
}

// errado: inglês
// Computes the sliding window of PDF pages

// errado: letra inicial maiúscula e primeira pessoa do plural
// Calculamos a janela de páginas para economizar memória
```

#### Python Docstring and Comment Examples

```python
"""validação de tokens jwt emitidos pelo supabase auth para rotas protegidas."""


def verify_supabase_jwt(token: str, jwt_secret: str) -> AuthenticatedUser:
    """valida a assinatura, a expiração e o identificador do usuário no token jwt."""
    # exige os campos sub e exp para impedir tokens anônimos sem dono
    ...
```

---

## 3. Implementation Pattern: XR Zone (`apps/web/src/zone/`)

In the XR Zone, **never mix pure math or state-machine logic with A-Frame DOM lifecycle calls.** Every spatial feature is split into two files:

1. **Pure System (`src/zone/systems/<feature>.ts`):** Zero runtime imports of `aframe` or `three`. Uses constants from `src/zone/config/constants.ts`. Directly unit-tested in Vitest's fast Node environment.
2. **Thin A-Frame Component Adapter (`src/zone/components/imx-<feature>.ts`):** Reads component schema attributes, delegates state transitions to the pure system, updates Three.js/A-Frame entities, and cleans up all event listeners, timers, and geometries in `remove()`.

### Example: Pure System (`src/zone/systems/`)

```ts
import { BELT_CLOSE_PITCH_DEG, BELT_OPEN_DWELL_MS, BELT_OPEN_PITCH_DEG } from '../config/constants';

export interface BeltVisibilityState {
  readonly isOpen: boolean;
  readonly belowThresholdMs: number;
}

// avalia a abertura do menu de cintura com histerese para evitar ativação acidental na leitura
export function stepBeltVisibility(
  state: BeltVisibilityState,
  cameraPitchDeg: number,
  deltaMs: number,
): BeltVisibilityState {
  if (state.isOpen) {
    return {
      isOpen: cameraPitchDeg <= BELT_CLOSE_PITCH_DEG,
      belowThresholdMs: 0,
    };
  }

  if (cameraPitchDeg < BELT_OPEN_PITCH_DEG) {
    const accumulated = state.belowThresholdMs + Math.max(0, deltaMs);
    return {
      isOpen: accumulated >= BELT_OPEN_DWELL_MS,
      belowThresholdMs: accumulated,
    };
  }

  return { isOpen: false, belowThresholdMs: 0 };
}
```

### Example: Thin A-Frame Adapter (`src/zone/components/`)

```ts
import AFRAME from 'aframe';
import { ZONE_THEME_CHANGE_EVENT, getThemePalette } from '../systems/theme-controller';

// registra o componente garantindo limpeza de ouvintes no ciclo de vida remove
export function registerExampleComponent(): void {
  if (AFRAME.components['imx-example']) {
    return;
  }

  AFRAME.registerComponent('imx-example', {
    schema: {
      active: { type: 'boolean', default: false },
    },

    init() {
      this.onThemeChange = () => {
        const palette = getThemePalette('light-glass');
        this.el.setAttribute('material', 'color', palette.panelBgColor);
      };
      window.addEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
    },

    remove() {
      // libera o listener registrado na inicialização para evitar vazamento de memória
      if (this.onThemeChange) {
        window.removeEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
      }
    },
  });
}
```

---

## 4. Implementation Pattern: Backend API (`apps/api/app/`)

All backend code follows four structural rules:

1. **Constants in `app/core/config.py`:** Never hardcode limits (`20 MB`, `60 pages`, `500 tokens`, `768 dimensions`) inside services or routers.
2. **`CamelModel` for JSON Contracts:** Python attributes use `snake_case`, while JSON payloads serialize and validate as `camelCase` via `CamelModel` (`apps/api/app/schemas/zones.py`) or `StudyPackModel` (`apps/api/app/schemas/study_pack.py`).
3. **Dependency Injection for Auth and Storage:** Routes depend on `get_current_user` and `get_db_store` (or service protocols like `get_embedding_client`) so `pytest` tests can inject `InMemoryStore` and fake clients without touching the network.
4. **Small Functions:** Keep functions focused on a single responsibility (target `<= 30` lines) and format with `ruff format` (`line-length = 100`).

### Example: FastAPI Route with Dependency Injection

```python
"""rota autenticada para consulta de status e progresso de jobs (seção 3.10)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import AuthenticatedUser, get_current_user
from app.core.db import DatabaseStore, get_db_store
from app.schemas.jobs import JobResponse

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobResponse)
def get_job_status(
    job_id: str,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    store: Annotated[DatabaseStore, Depends(get_db_store)],
) -> JobResponse:
    """retorna o estado atual e o percentual de progresso de um job do usuário."""
    record = store.get_job(current_user.user_id, job_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    return JobResponse(
        id=record.id,
        zone_id=record.zone_id,
        status=record.status,
        progress=record.progress,
        message=record.message,
    )
```

---

## 5. Pre-Commit Verification Checklist

Before committing any change, run the three verification commands from the repository root:

```bash
pnpm lint
pnpm test
pnpm build
```

All three commands must exit with code `0` and zero warnings. Commit messages must be written in English following Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
