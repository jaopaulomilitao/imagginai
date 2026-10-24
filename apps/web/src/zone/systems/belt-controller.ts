import {
  BELT_ARC_MAX_HALF_WIDTH_DEG,
  BELT_CENTER_PITCH_DEG,
  BELT_EXIT_CONFIRM_TIMEOUT_MS,
  BELT_FADE_DURATION_MS,
  BELT_HIDE_PITCH_THRESHOLD_DEG,
  BELT_MAX_ITEMS,
  BELT_RADIUS_M,
  BELT_SHOW_DWELL_MS,
  BELT_SHOW_PITCH_THRESHOLD_DEG,
  BELT_SUBMENU_MAX_PITCH_DEG,
  BELT_SUBMENU_MAX_YAW_DELTA_DEG,
  BELT_YAW_LERP_ALPHA,
} from '../config/constants';

export const BELT_ITEM_IDS = [
  'exit-zone',
  'switch-zone',
  'recenter',
  'open-contents',
  'toggle-pomodoro',
  'toggle-mode',
  'toggle-theme',
] as const;

export type BeltItemId = (typeof BELT_ITEM_IDS)[number];

export interface BeltItemPlacement {
  readonly id: BeltItemId;
  readonly yawOffsetDeg: number;
  readonly pitchDeg: number;
  readonly radiusM: number;
  readonly disabled: boolean;
  readonly prominent: boolean;
}

export interface BeltMenuSnapshot {
  readonly visible: boolean;
  readonly opacity: number;
  readonly beltYawDeg: number;
  readonly lowPitchAccumulatedMs: number;
  readonly exitConfirmPending: boolean;
  readonly exitConfirmRemainingMs: number;
  readonly submenuOpen: boolean;
  readonly pointerIntersecting: boolean;
}

export type ExitActionResult = 'confirm-pending' | 'confirmed';

// normaliza um ângulo em graus para o intervalo circular [-180, 180]
export function normalizeYawDeg(angleDeg: number): number {
  let wrapped = ((((angleDeg + 180) % 360) + 360) % 360) - 180;
  if (Object.is(wrapped, -0)) wrapped = 0;
  return wrapped;
}

// interpola suavemente entre dois ângulos em graus pelo menor arco circular
export function lerpYawDeg(currentDeg: number, targetDeg: number, alpha: number): number {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const delta = normalizeYawDeg(targetDeg - currentDeg);
  return normalizeYawDeg(currentDeg + delta * clampedAlpha);
}

// calcula os deslocamentos angulares dos itens do menu com espaçamento amplo e 'open-contents' centralizado em 0 grau
export function computeBeltItemPlacements(
  ids: readonly BeltItemId[] = BELT_ITEM_IDS,
  arcHalfWidthDeg = 52,
): BeltItemPlacement[] {
  const capped = ids.slice(0, BELT_MAX_ITEMS);
  const clampedHalfWidth = Math.min(Math.abs(arcHalfWidthDeg), BELT_ARC_MAX_HALF_WIDTH_DEG);
  const count = capped.length;

  return capped.map((id, index) => {
    const yawOffsetDeg =
      count <= 1 ? 0 : -clampedHalfWidth + (index / (count - 1)) * (2 * clampedHalfWidth);
    return {
      id,
      yawOffsetDeg: Math.round(yawOffsetDeg * 100) / 100,
      pitchDeg: BELT_CENTER_PITCH_DEG,
      radiusM: BELT_RADIUS_M,
      disabled: false,
      prominent: id === 'open-contents',
    };
  });
}

// controla a abertura/fechamento, trava de interseção para submenus, transição de opacidade e confirmação de saída
export class BeltMenuController {
  private visible = false;
  private opacity = 0;
  private beltYawDeg = 0;
  private yawInitialized = false;
  private lowPitchAccumulatedMs = 0;
  private exitConfirmRemainingMs = 0;
  private submenuOpen = false;
  private pointerIntersecting = false;

  constructor(
    private readonly showPitchThresholdDeg = BELT_SHOW_PITCH_THRESHOLD_DEG,
    private readonly hidePitchThresholdDeg = BELT_HIDE_PITCH_THRESHOLD_DEG,
    private readonly showDwellMs = BELT_SHOW_DWELL_MS,
    private readonly yawLerpAlpha = BELT_YAW_LERP_ALPHA,
    private readonly exitConfirmTimeoutMs = BELT_EXIT_CONFIRM_TIMEOUT_MS,
  ) {}

  get snapshot(): BeltMenuSnapshot {
    return {
      visible: this.visible,
      opacity: this.opacity,
      beltYawDeg: this.beltYawDeg,
      lowPitchAccumulatedMs: this.lowPitchAccumulatedMs,
      exitConfirmPending: this.exitConfirmRemainingMs > 0,
      exitConfirmRemainingMs: this.exitConfirmRemainingMs,
      submenuOpen: this.submenuOpen,
      pointerIntersecting: this.pointerIntersecting,
    };
  }

  setSubmenuOpen(open: boolean): void {
    this.submenuOpen = open;
    if (open && !this.visible) {
      this.visible = true;
      this.opacity = 1;
    }
  }

  setPointerIntersecting(intersecting: boolean): void {
    this.pointerIntersecting = intersecting;
  }

  update(cameraYawDeg: number, cameraPitchDeg: number, deltaMs: number): BeltMenuSnapshot {
    const dt = Math.max(0, deltaMs);
    const normalizedYaw = normalizeYawDeg(cameraYawDeg);

    if (!this.yawInitialized) {
      this.beltYawDeg = normalizedYaw;
      this.yawInitialized = true;
    }

    if (this.exitConfirmRemainingMs > 0) {
      this.exitConfirmRemainingMs = Math.max(0, this.exitConfirmRemainingMs - dt);
    }

    if (!this.visible) {
      // acompanha suavemente o yaw da cabeça enquanto oculto
      this.beltYawDeg = lerpYawDeg(this.beltYawDeg, normalizedYaw, this.yawLerpAlpha);

      if (cameraPitchDeg < this.showPitchThresholdDeg) {
        this.lowPitchAccumulatedMs += dt;
        if (this.lowPitchAccumulatedMs >= this.showDwellMs) {
          this.visible = true;
          this.lowPitchAccumulatedMs = this.showDwellMs;
          this.beltYawDeg = normalizedYaw;
        }
      } else {
        this.lowPitchAccumulatedMs = 0;
      }
    } else {
      // trava de interseção e retenção de olhar:
      // se o ponteiro estiver sobre o menu/submenu, jamais fecha;
      // se um submenu estiver aberto, só fecha quando o usuário olha completamente para fora do menu e do submenu
      if (!this.pointerIntersecting) {
        const yawDelta = Math.abs(normalizeYawDeg(normalizedYaw - this.beltYawDeg));
        if (this.submenuOpen) {
          const lookedCompletelyAway =
            cameraPitchDeg > BELT_SUBMENU_MAX_PITCH_DEG ||
            yawDelta > BELT_SUBMENU_MAX_YAW_DELTA_DEG;
          if (lookedCompletelyAway) {
            this.visible = false;
            this.submenuOpen = false;
            this.lowPitchAccumulatedMs = 0;
            this.exitConfirmRemainingMs = 0;
          }
        } else {
          const lookedAwayFromMainBelt =
            cameraPitchDeg > this.hidePitchThresholdDeg ||
            yawDelta > BELT_SUBMENU_MAX_YAW_DELTA_DEG;
          if (lookedAwayFromMainBelt) {
            this.visible = false;
            this.lowPitchAccumulatedMs = 0;
            this.exitConfirmRemainingMs = 0;
          }
        }
      }
    }

    // atualiza suavemente a opacidade de fade-in / fade-out
    const fadeStep = BELT_FADE_DURATION_MS > 0 ? dt / BELT_FADE_DURATION_MS : 1;
    if (this.visible) {
      this.opacity = Math.min(1, this.opacity + fadeStep);
    } else {
      this.opacity = Math.max(0, this.opacity - fadeStep);
    }

    return this.snapshot;
  }

  triggerExitAction(): ExitActionResult {
    if (this.exitConfirmRemainingMs > 0) {
      this.exitConfirmRemainingMs = 0;
      return 'confirmed';
    }
    this.exitConfirmRemainingMs = this.exitConfirmTimeoutMs;
    return 'confirm-pending';
  }

  cancelExitConfirm(): void {
    this.exitConfirmRemainingMs = 0;
  }

  forceHide(): void {
    this.visible = false;
    this.submenuOpen = false;
    this.pointerIntersecting = false;
    this.opacity = 0;
    this.lowPitchAccumulatedMs = 0;
    this.exitConfirmRemainingMs = 0;
  }
}
