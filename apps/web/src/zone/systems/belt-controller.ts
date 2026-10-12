import {
  BELT_ARC_MAX_HALF_WIDTH_DEG,
  BELT_CENTER_PITCH_DEG,
  BELT_EXIT_CONFIRM_TIMEOUT_MS,
  BELT_HIDE_PITCH_THRESHOLD_DEG,
  BELT_MAX_ITEMS,
  BELT_RADIUS_M,
  BELT_SHOW_DWELL_MS,
  BELT_SHOW_PITCH_THRESHOLD_DEG,
  BELT_YAW_LERP_ALPHA,
} from '../config/constants';

export const BELT_ITEM_IDS = [
  'exit-zone',
  'switch-zone',
  'toggle-mode',
  'toggle-pomodoro',
  'recenter',
  'ai-assistant',
] as const;

export type BeltItemId = (typeof BELT_ITEM_IDS)[number];

export interface BeltItemPlacement {
  readonly id: BeltItemId;
  readonly yawOffsetDeg: number;
  readonly pitchDeg: number;
  readonly radiusM: number;
  readonly disabled: boolean;
}

export interface BeltMenuSnapshot {
  readonly visible: boolean;
  readonly beltYawDeg: number;
  readonly lowPitchAccumulatedMs: number;
  readonly exitConfirmPending: boolean;
  readonly exitConfirmRemainingMs: number;
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

// calcula os deslocamentos angulares dos itens do cinto dentro do arco máximo de +-40 graus
export function computeBeltItemPlacements(
  ids: readonly BeltItemId[] = BELT_ITEM_IDS,
  arcHalfWidthDeg = 38,
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
      disabled: id === 'ai-assistant',
    };
  });
}

// controla a histerese de abertura/fechamento, o congelamento de yaw e a confirmação de saída do belt menu
export class BeltMenuController {
  private visible = false;
  private beltYawDeg = 0;
  private yawInitialized = false;
  private lowPitchAccumulatedMs = 0;
  private exitConfirmRemainingMs = 0;

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
      beltYawDeg: this.beltYawDeg,
      lowPitchAccumulatedMs: this.lowPitchAccumulatedMs,
      exitConfirmPending: this.exitConfirmRemainingMs > 0,
      exitConfirmRemainingMs: this.exitConfirmRemainingMs,
    };
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
      // enquanto oculto, acompanha o yaw da cabeça com interpolação suave
      this.beltYawDeg = lerpYawDeg(this.beltYawDeg, normalizedYaw, this.yawLerpAlpha);

      if (cameraPitchDeg < this.showPitchThresholdDeg) {
        this.lowPitchAccumulatedMs += dt;
        if (this.lowPitchAccumulatedMs >= this.showDwellMs) {
          this.visible = true;
          this.lowPitchAccumulatedMs = this.showDwellMs;
          // congela o yaw atual no instante em que o menu se torna visível
          this.beltYawDeg = normalizedYaw;
        }
      } else {
        this.lowPitchAccumulatedMs = 0;
      }
    } else {
      // enquanto visível, mantém o yaw congelado e só oculta quando pitch > -20 graus (histerese)
      if (cameraPitchDeg > this.hidePitchThresholdDeg) {
        this.visible = false;
        this.lowPitchAccumulatedMs = 0;
        this.exitConfirmRemainingMs = 0;
      }
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
    this.lowPitchAccumulatedMs = 0;
    this.exitConfirmRemainingMs = 0;
  }
}
