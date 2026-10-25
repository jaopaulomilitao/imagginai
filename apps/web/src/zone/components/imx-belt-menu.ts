import AFRAME, { type Component, type Entity } from 'aframe';
import type { CursorComponent } from 'interacxr';

import { PT_BR } from '../../shared/i18n/pt-br';
import { logger } from '../../shared/logger';
import { resolveBundledDemoPack, zoneStorage } from '../../shared/storage/dexie-db';
import type { StudyCard } from '../../shared/types/study-pack';
import type { Zone } from '../../shared/types/zone';
import type { ModeComponent } from './imx-mode';
import {
  ZONE_ACTIVE_CONTENTS_CHANGE_EVENT,
  ZONE_ADD_CONTENT_REQUEST_EVENT,
  ZONE_EXIT_FINALIZE_EVENT,
  ZONE_POMODORO_QUIZ_REQUEST_EVENT,
  ZONE_RECENTER_REQUEST_EVENT,
  ZONE_SWITCH_REQUEST_EVENT,
  type ActiveContentsChangeDetail,
  type AddContentRequestDetail,
  type PomodoroQuizRequestDetail,
  type RecenterRequestDetail,
  type SpawnableContentKind,
  type SwitchZoneRequestDetail,
} from './zone-workspace';
import {
  BELT_CENTER_PITCH_DEG,
  BELT_ITEM_HEIGHT_M,
  BELT_ITEM_WIDTH_M,
  BELT_PRIMARY_ITEM_HEIGHT_M,
  BELT_PRIMARY_ITEM_WIDTH_M,
  BELT_RADIUS_M,
  BELT_SHORTCUT_CONTENTS_KEY,
  BELT_SHORTCUT_EXIT_KEY,
  BELT_SHORTCUT_MODE_KEY,
  BELT_SHORTCUT_POMODORO_KEY,
  BELT_SHORTCUT_RECENTER_KEY,
  BELT_SHORTCUT_THEME_KEY,
  BELT_SHORTCUT_ZONES_KEY,
  DEFAULT_DEMO_ZONE_ID,
  DEFAULT_POMODORO_PRESET,
  type PomodoroPreset,
  type ZoneTheme,
} from '../config/constants';
import {
  BeltMenuController,
  computeBeltItemPlacements,
  normalizeYawDeg,
  type BeltItemId,
  type BeltItemPlacement,
} from '../systems/belt-controller';
import {
  createPhosphorIconEntity,
  updatePhosphorIconAppearance,
  type PhosphorVrIconName,
} from '../systems/phosphor-icon-canvas';
import {
  formatPomodoroMmSs,
  PomodoroSystem,
  type PomodoroStepEvents,
} from '../systems/pomodoro-system';
import { PerfDegradationController } from '../systems/perf-degradation-controller';
import '../systems/rounded-shape';
import {
  directionToSphericalAngles,
  panelFacingPitchDeg,
  panelFacingYawDeg,
  sphericalToCartesian,
} from '../systems/spherical';
import {
  getThemePalette,
  resolveInitialTheme,
  toggleTheme,
  ZONE_THEME_CHANGE_EVENT,
  ZONE_THEME_STORAGE_KEY,
} from '../systems/theme-controller';

export type VrContentsFilterTab = 'content' | 'flashcards' | 'quiz' | 'studyObjects';

interface BeltMenuData {
  cameraSelector: string;
  zoneId: string;
  pomodoroPreset: PomodoroPreset;
}

export interface BeltMenuComponent extends Component<BeltMenuData> {
  controller?: BeltMenuBridge;
}

interface BeltButtonRefs {
  readonly id: BeltItemId;
  readonly placement: BeltItemPlacement;
  readonly width: number;
  readonly height: number;
  readonly containerEl: Entity;
  readonly bgEl: Entity;
  readonly borderEl: Entity;
  readonly iconEl: Entity;
  readonly labelEl: Entity;
}

interface SubmenuContentGridItem {
  readonly contentId: string;
  readonly kind: SpawnableContentKind;
  readonly categoryLabel: string;
  readonly title: string;
  readonly card: StudyCard;
  readonly pageCount?: number;
  readonly accentColor: string;
  readonly icon: PhosphorVrIconName;
}

function createTroikaText(options: {
  position: string;
  value: string;
  color: string;
  fontSize: number;
  maxWidth: number;
  lineHeight?: number;
  align?: string;
}): Entity {
  const el = document.createElement('a-troika-text') as Entity;
  const lineH = options.lineHeight ?? 1.2;
  const align = options.align ?? 'center';
  el.setAttribute('position', options.position);
  el.setAttribute('value', options.value);
  el.setAttribute('color', options.color);
  el.setAttribute('align', align);
  el.setAttribute('anchor', 'center');
  el.setAttribute('baseline', 'center');
  el.setAttribute('font-size', String(options.fontSize));
  el.setAttribute('fontSize', String(options.fontSize));
  el.setAttribute('max-width', String(options.maxWidth));
  el.setAttribute('maxWidth', String(options.maxWidth));
  el.setAttribute('line-height', String(lineH));
  el.setAttribute('lineHeight', String(lineH));
  el.setAttribute(
    'troika-text',
    `value: ${options.value}; color: ${options.color}; fontSize: ${options.fontSize}; maxWidth: ${options.maxWidth}; lineHeight: ${lineH}; align: ${align}; anchor: center; baseline: center`,
  );
  return el;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

// integra o menu principal ergonômico, o submenu em grade com filtros e o temporizador pomodoro à cena vr
export class BeltMenuBridge {
  readonly beltController = new BeltMenuController();
  readonly pomodoro: PomodoroSystem;
  readonly perfDegradation = new PerfDegradationController();

  private readonly rootEl: Entity;
  private readonly beltGroupEl: Entity;
  private readonly statusPillEl: Entity;
  private statusTextEl: Entity;
  private readonly zonesCardEl: Entity;
  private readonly breakCardEl: Entity;
  private breakTimerTextEl: Entity;
  private readonly itemButtons: BeltButtonRefs[] = [];
  private readonly unsubscribePomodoro: () => void;
  private readonly forwardVec = new AFRAME.THREE.Vector3();

  private lastCameraYawDeg = 0;
  private toastMessage: string | null = null;
  private toastRemainingMs = 0;
  private zonesPickerOpen = false;
  private contentsPickerOpen = false;
  private contentsFilterTab: VrContentsFilterTab = 'flashcards';
  private contentsPageIndex = 0;
  private activeZoneId: string;
  private currentTheme: ZoneTheme;
  private statusBorderEl: Entity | null = null;
  private statusBgEl: Entity | null = null;
  private readonly activeSceneContentIds = new Set<string>();

  private readonly onThemeChange = (event: Event): void => {
    const detail = (event as CustomEvent<{ theme: ZoneTheme }>).detail;
    if (detail?.theme && detail.theme !== this.currentTheme) {
      this.currentTheme = detail.theme;
      this.applyTheme(detail.theme);
    }
  };

  private readonly onActiveContentsChange = (event: Event): void => {
    const detail = (event as CustomEvent<ActiveContentsChangeDetail>).detail;
    if (!detail?.activeContentIds) return;
    this.activeSceneContentIds.clear();
    for (const id of detail.activeContentIds) {
      this.activeSceneContentIds.add(id);
    }
    if (this.contentsPickerOpen) {
      void this.populateContentsPicker();
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    if (isEditableElement(event.target)) return;

    const key = event.key.toLowerCase();
    if (key === BELT_SHORTCUT_EXIT_KEY) {
      this.executeAction('exit-zone');
    } else if (key === BELT_SHORTCUT_ZONES_KEY) {
      this.executeAction('switch-zone');
    } else if (key === BELT_SHORTCUT_CONTENTS_KEY) {
      this.executeAction('open-contents');
    } else if (key === BELT_SHORTCUT_MODE_KEY) {
      this.executeAction('toggle-mode');
    } else if (key === BELT_SHORTCUT_THEME_KEY) {
      this.executeAction('toggle-theme');
    } else if (key === BELT_SHORTCUT_POMODORO_KEY) {
      this.executeAction('toggle-pomodoro');
    } else if (key === BELT_SHORTCUT_RECENTER_KEY) {
      this.executeAction('recenter');
    }
  };

  constructor(
    private readonly el: Entity,
    private data: BeltMenuData,
  ) {
    this.activeZoneId = data.zoneId || DEFAULT_DEMO_ZONE_ID;
    this.pomodoro = new PomodoroSystem(data.pomodoroPreset);

    let storedPref: string | null = null;
    try {
      storedPref = localStorage.getItem(ZONE_THEME_STORAGE_KEY);
    } catch {
      // ignora
    }
    this.currentTheme = resolveInitialTheme(storedPref);

    this.rootEl = document.createElement('a-entity') as Entity;
    this.beltGroupEl = document.createElement('a-entity') as Entity;
    this.statusPillEl = document.createElement('a-entity') as Entity;
    this.statusTextEl = document.createElement('a-troika-text') as Entity;
    this.zonesCardEl = document.createElement('a-entity') as Entity;
    this.breakCardEl = document.createElement('a-entity') as Entity;
    this.breakTimerTextEl = document.createElement('a-troika-text') as Entity;

    this.buildBeltDom();
    this.buildBreakScreenDom();
    this.el.appendChild(this.rootEl);

    this.unsubscribePomodoro = this.pomodoro.subscribe((events) =>
      this.handlePomodoroEvents(events),
    );
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
    this.el.sceneEl?.addEventListener(
      ZONE_ACTIVE_CONTENTS_CHANGE_EVENT,
      this.onActiveContentsChange,
    );
    this.syncBeltVisuals();
  }

  updateData(nextData: BeltMenuData): void {
    this.data = nextData;
    if (nextData.zoneId) {
      this.activeZoneId = nextData.zoneId;
    }
    this.pomodoro.setPreset(nextData.pomodoroPreset);
  }

  tick(deltaMs: number): void {
    const dt = Math.max(0, deltaMs);
    if (this.toastRemainingMs > 0) {
      this.toastRemainingMs = Math.max(0, this.toastRemainingMs - dt);
      if (this.toastRemainingMs === 0) {
        this.toastMessage = null;
      }
    }

    this.pomodoro.step(dt);

    const instantFps = dt > 0 ? Math.min(120, 1000 / dt) : 60;
    const perfReport = this.perfDegradation.recordSample(dt, instantFps);
    if (perfReport?.economyJustTriggered) {
      this.showToast('Modo econômico ativado (10 Hz) para manter fluidez', 3500);
    }

    // verifica se o cursor/raio está sobre qualquer elemento do menu ou submenu (trava de interseção)
    const hovered = this.readCurrentHoveredElement();
    const isHoveringMenu = hovered !== null && this.rootEl.contains(hovered);
    this.beltController.setPointerIntersecting(isHoveringMenu);
    this.beltController.setSubmenuOpen(this.zonesPickerOpen || this.contentsPickerOpen);

    const angles = this.readCameraSphericalAngles();
    if (angles) {
      this.lastCameraYawDeg = angles.yawDeg;
      const prevVisible = this.beltController.snapshot.visible;
      const snap = this.beltController.update(angles.yawDeg, angles.pitchDeg, dt);
      if (prevVisible && !snap.visible) {
        this.zonesPickerOpen = false;
        this.contentsPickerOpen = false;
        this.zonesCardEl.setAttribute('visible', 'false');
        this.zonesCardEl.object3D.visible = false;
      }
    }

    this.syncBeltVisuals();
    this.syncBreakScreenVisuals();
  }

  executeAction(id: BeltItemId): void {
    switch (id) {
      case 'exit-zone': {
        const result = this.beltController.triggerExitAction();
        if (result === 'confirm-pending') {
          this.showToast(PT_BR.zone.belt.feedback.exitConfirmPrompt, 3000);
        } else {
          void this.performExitZone();
        }
        break;
      }
      case 'switch-zone': {
        this.contentsPickerOpen = false;
        this.zonesPickerOpen = !this.zonesPickerOpen;
        this.beltController.setSubmenuOpen(this.zonesPickerOpen);
        if (this.zonesPickerOpen) {
          void this.populateZonesPicker();
        } else {
          this.zonesCardEl.setAttribute('visible', 'false');
          this.zonesCardEl.object3D.visible = false;
        }
        break;
      }
      case 'open-contents': {
        this.zonesPickerOpen = false;
        this.contentsPickerOpen = !this.contentsPickerOpen;
        this.beltController.setSubmenuOpen(this.contentsPickerOpen);
        if (this.contentsPickerOpen) {
          this.contentsPageIndex = 0;
          void this.populateContentsPicker();
        } else {
          this.zonesCardEl.setAttribute('visible', 'false');
          this.zonesCardEl.object3D.visible = false;
        }
        break;
      }
      case 'toggle-mode': {
        const modeComp = this.el.sceneEl.components['imx-mode'] as ModeComponent | undefined;
        const snapshot = modeComp?.controller?.toggle();
        if (snapshot) {
          const label = PT_BR.zone.modeLabels[snapshot.targetMode];
          this.showToast(`Modo: ${label}`, 1800);
        }
        break;
      }
      case 'toggle-theme': {
        this.currentTheme = toggleTheme(this.currentTheme);
        try {
          localStorage.setItem(ZONE_THEME_STORAGE_KEY, this.currentTheme);
        } catch {
          // ignora
        }
        const palette = getThemePalette(this.currentTheme);
        const detail = { theme: this.currentTheme };
        window.dispatchEvent(new CustomEvent(ZONE_THEME_CHANGE_EVENT, { detail }));
        this.el.sceneEl?.emit(ZONE_THEME_CHANGE_EVENT, detail);
        this.applyTheme(this.currentTheme);
        this.showToast(PT_BR.zone.belt.feedback.themeChanged(palette.name), 2000);
        break;
      }
      case 'toggle-pomodoro': {
        const snap = this.pomodoro.toggle();
        const mmss = formatPomodoroMmSs(snap.remainingMs);
        if (snap.phase === 'focus') {
          this.showToast(PT_BR.zone.pomodoro.focusRunning(mmss), 1800);
        } else if (snap.phase === 'paused') {
          this.showToast(PT_BR.zone.pomodoro.focusPaused(mmss), 1800);
        }
        break;
      }
      case 'recenter': {
        const detail: RecenterRequestDetail = { cameraYawDeg: this.lastCameraYawDeg };
        this.el.sceneEl.emit(ZONE_RECENTER_REQUEST_EVENT, detail);
        this.showToast(PT_BR.zone.belt.feedback.recentered, 2000);
        break;
      }
    }
    this.syncBeltVisuals();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
    this.el.sceneEl?.removeEventListener(
      ZONE_ACTIVE_CONTENTS_CHANGE_EVENT,
      this.onActiveContentsChange,
    );
    this.unsubscribePomodoro();
    this.rootEl.remove();
  }

  private buildBeltDom(): void {
    this.beltGroupEl.setAttribute('visible', 'false');
    this.beltGroupEl.object3D.visible = false;

    const placements = computeBeltItemPlacements();
    for (const placement of placements) {
      const btn = this.createBeltButton(placement);
      this.itemButtons.push(btn);
      this.beltGroupEl.appendChild(btn.containerEl);
    }

    const statusPalette = getThemePalette(this.currentTheme);
    this.statusBorderEl = document.createElement('a-entity') as Entity;
    this.statusBorderEl.setAttribute(
      'geometry',
      'primitive: rounded-rect; width: 0.56; height: 0.068; radius: 0.034',
    );
    this.statusBorderEl.setAttribute('position', '0 0 -0.001');
    this.statusBorderEl.setAttribute(
      'material',
      'shader: flat; color: #F5F3EB; opacity: 0.85; transparent: true',
    );
    this.statusPillEl.appendChild(this.statusBorderEl);

    this.statusBgEl = document.createElement('a-entity') as Entity;
    this.statusBgEl.setAttribute(
      'geometry',
      'primitive: rounded-rect; width: 0.55; height: 0.06; radius: 0.03',
    );
    this.statusBgEl.setAttribute('position', '0 0 0');
    this.statusBgEl.setAttribute(
      'material',
      `shader: flat; color: ${statusPalette.statusPillBgColor}; opacity: 0.9; transparent: true`,
    );
    this.statusPillEl.appendChild(this.statusBgEl);

    this.statusTextEl = createTroikaText({
      position: '0 0 0.004',
      value: PT_BR.zone.pomodoro.idle,
      color: statusPalette.statusPillTextColor,
      fontSize: 0.019,
      maxWidth: 0.5,
    });
    this.statusPillEl.appendChild(this.statusTextEl);
    this.beltGroupEl.appendChild(this.statusPillEl);

    this.zonesCardEl.setAttribute('visible', 'false');
    this.zonesCardEl.object3D.visible = false;
    this.beltGroupEl.appendChild(this.zonesCardEl);

    this.rootEl.appendChild(this.beltGroupEl);
  }

  private createBeltButton(placement: BeltItemPlacement): BeltButtonRefs {
    const containerEl = document.createElement('a-entity') as Entity;
    const isProminent = placement.prominent;
    const width = isProminent ? BELT_PRIMARY_ITEM_WIDTH_M : BELT_ITEM_WIDTH_M;
    const height = isProminent ? BELT_PRIMARY_ITEM_HEIGHT_M : BELT_ITEM_HEIGHT_M;
    const palette = getThemePalette(this.currentTheme);
    const stroke = isProminent ? 0.007 : 0.004;

    const borderColor = isProminent ? '#EA580C' : palette.beltButtonBorderColor;
    const bgColor = isProminent ? '#18181B' : palette.beltButtonBgColor;

    const borderEl = document.createElement('a-entity') as Entity;
    borderEl.setAttribute('geometry', {
      primitive: 'rounded-rect',
      width: width + 2 * stroke,
      height: height + 2 * stroke,
      radius: 0.022 + stroke,
    });
    borderEl.setAttribute('position', '0 0 -0.002');
    borderEl.setAttribute(
      'material',
      `shader: flat; color: ${borderColor}; opacity: ${isProminent ? 0.98 : palette.beltButtonBorderOpacity}; transparent: true`,
    );
    containerEl.appendChild(borderEl);

    const bgEl = document.createElement('a-entity') as Entity;
    bgEl.classList.add('interactable');
    bgEl.setAttribute('geometry', {
      primitive: 'rounded-rect',
      width,
      height,
      radius: 0.02,
    });
    bgEl.setAttribute('position', '0 0 0.002');
    bgEl.setAttribute(
      'material',
      `shader: flat; color: ${bgColor}; opacity: ${isProminent ? 0.96 : palette.beltButtonBgOpacity}; transparent: true`,
    );
    bgEl.addEventListener('click', (event: Event) => {
      event.stopPropagation();
      this.executeAction(placement.id);
    });
    containerEl.appendChild(bgEl);

    const copy = PT_BR.zone.belt.items[placement.id];
    const iconColor = isProminent ? '#F59E0B' : palette.beltIconColor;
    const iconEl = createPhosphorIconEntity({
      icon: copy.icon as PhosphorVrIconName,
      color: iconColor,
      size: isProminent ? 0.048 : 0.036,
      position: `0 ${isProminent ? 0.024 : 0.018} 0.006`,
    });
    containerEl.appendChild(iconEl);

    const labelColor = isProminent ? '#F5F3EB' : palette.beltLabelColor;
    const labelEl = createTroikaText({
      position: `0 ${isProminent ? -0.042 : -0.032} 0.006`,
      value: copy.label,
      color: labelColor,
      fontSize: isProminent ? 0.022 : 0.018,
      maxWidth: width - 0.014,
    });
    containerEl.appendChild(labelEl);

    const refs: BeltButtonRefs = {
      id: placement.id,
      placement,
      width,
      height,
      containerEl,
      bgEl,
      borderEl,
      iconEl,
      labelEl,
    };

    bgEl.addEventListener('mouseenter', () => {
      this.beltController.setPointerIntersecting(true);
      this.setButtonHighlight(refs, true);
    });
    bgEl.addEventListener('mouseleave', () => {
      this.setButtonHighlight(refs, false);
    });

    return refs;
  }

  private setButtonHighlight(btn: BeltButtonRefs, active: boolean): void {
    const palette = getThemePalette(this.currentTheme);
    const stroke = active ? 0.01 : btn.placement.prominent ? 0.007 : 0.004;
    const borderColor = active
      ? '#F59E0B'
      : btn.placement.prominent
        ? '#EA580C'
        : palette.beltButtonBorderColor;
    btn.borderEl.setAttribute('geometry', {
      primitive: 'rounded-rect',
      width: btn.width + 2 * stroke,
      height: btn.height + 2 * stroke,
      radius: 0.022 + stroke,
    });
    btn.borderEl.setAttribute(
      'material',
      `shader: flat; color: ${borderColor}; opacity: 1.0; transparent: true`,
    );
  }

  applyTheme(theme: ZoneTheme): void {
    this.currentTheme = theme;
    const palette = getThemePalette(theme);

    for (const btn of this.itemButtons) {
      const isProm = btn.placement.prominent;
      const borderColor = isProm ? '#EA580C' : palette.beltButtonBorderColor;
      const bgColor = isProm ? '#18181B' : palette.beltButtonBgColor;
      const iconColor = isProm ? '#F59E0B' : palette.beltIconColor;
      const labelColor = isProm ? '#F5F3EB' : palette.beltLabelColor;

      btn.borderEl.setAttribute(
        'material',
        `shader: flat; color: ${borderColor}; opacity: ${isProm ? 0.98 : palette.beltButtonBorderOpacity}; transparent: true`,
      );
      btn.bgEl.setAttribute(
        'material',
        `shader: flat; color: ${bgColor}; opacity: ${isProm ? 0.96 : palette.beltButtonBgOpacity}; transparent: true`,
      );
      updatePhosphorIconAppearance(btn.iconEl, iconColor);
      btn.labelEl.setAttribute('color', labelColor);
      btn.labelEl.setAttribute('troika-text', 'color', labelColor);
    }

    this.statusBorderEl?.setAttribute(
      'material',
      'shader: flat; color: #F5F3EB; opacity: 0.85; transparent: true',
    );
    this.statusBgEl?.setAttribute(
      'material',
      `shader: flat; color: ${palette.statusPillBgColor}; opacity: 0.9; transparent: true`,
    );
    this.statusTextEl.setAttribute('color', palette.statusPillTextColor);
    this.statusTextEl.setAttribute('troika-text', 'color', palette.statusPillTextColor);
  }

  private buildBreakScreenDom(): void {
    this.breakCardEl.setAttribute('visible', 'false');
    this.breakCardEl.object3D.visible = false;

    const borderEl = document.createElement('a-entity') as Entity;
    borderEl.setAttribute(
      'geometry',
      'primitive: rounded-rect; width: 0.59; height: 0.35; radius: 0.032',
    );
    borderEl.setAttribute('position', '0 0 -0.002');
    borderEl.setAttribute(
      'material',
      'shader: flat; color: #F5F3EB; opacity: 0.88; transparent: true',
    );
    this.breakCardEl.appendChild(borderEl);

    const bgEl = document.createElement('a-entity') as Entity;
    bgEl.setAttribute(
      'geometry',
      'primitive: rounded-rect; width: 0.58; height: 0.34; radius: 0.028',
    );
    bgEl.setAttribute('material', 'shader: flat; color: #121316; opacity: 0.96; transparent: true');
    this.breakCardEl.appendChild(bgEl);

    const titleEl = createTroikaText({
      position: '0 0.1 0.005',
      value: PT_BR.zone.pomodoro.breakTitle,
      color: '#F59E0B',
      fontSize: 0.023,
      maxWidth: 0.5,
    });
    this.breakCardEl.appendChild(titleEl);

    const bodyEl = createTroikaText({
      position: '0 0.02 0.005',
      value: PT_BR.zone.pomodoro.breakBody,
      color: '#F5F3EB',
      fontSize: 0.018,
      lineHeight: 1.3,
      maxWidth: 0.48,
    });
    this.breakCardEl.appendChild(bodyEl);

    this.breakTimerTextEl = createTroikaText({
      position: '0 -0.05 0.005',
      value: PT_BR.zone.pomodoro.breakTimer('05:00'),
      color: '#38BDF8',
      fontSize: 0.02,
      maxWidth: 0.45,
    });
    this.breakCardEl.appendChild(this.breakTimerTextEl);

    const skipBtn = document.createElement('a-plane') as Entity;
    skipBtn.classList.add('interactable');
    skipBtn.setAttribute('width', '0.28');
    skipBtn.setAttribute('height', '0.06');
    skipBtn.setAttribute('position', '0 -0.115 0.01');
    skipBtn.setAttribute(
      'material',
      'shader: flat; color: #EA580C; opacity: 0.96; transparent: true',
    );
    skipBtn.addEventListener('click', (event: Event) => {
      event.stopPropagation();
      this.pomodoro.skipBreak();
      this.syncBreakScreenVisuals();
    });

    const skipLabel = createTroikaText({
      position: '0 0 0.004',
      value: PT_BR.zone.pomodoro.skipBreakButton,
      color: '#F5F3EB',
      fontSize: 0.017,
      maxWidth: 0.25,
    });
    skipBtn.appendChild(skipLabel);
    this.breakCardEl.appendChild(skipBtn);

    this.rootEl.appendChild(this.breakCardEl);
  }

  private async populateZonesPicker(): Promise<void> {
    while (this.zonesCardEl.firstChild) {
      this.zonesCardEl.removeChild(this.zonesCardEl.firstChild);
    }

    const storedZones: Zone[] = (await zoneStorage.listDownloadedZones?.()) ?? [];
    const options: { id: string; name: string }[] = [
      { id: DEFAULT_DEMO_ZONE_ID, name: PT_BR.zone.belt.feedback.demoZoneName },
    ];
    for (const z of storedZones) {
      if (z.id !== DEFAULT_DEMO_ZONE_ID) {
        options.push({ id: z.id, name: z.name });
      }
    }

    const cardHeight = 0.1 + options.length * 0.062;
    const borderEl = document.createElement('a-plane') as Entity;
    borderEl.setAttribute('width', '0.568');
    borderEl.setAttribute('height', String(cardHeight + 0.008));
    borderEl.setAttribute('position', '0 0 -0.002');
    borderEl.setAttribute(
      'material',
      'shader: flat; color: #F5F3EB; opacity: 0.9; transparent: true',
    );
    this.zonesCardEl.appendChild(borderEl);

    const bgEl = document.createElement('a-plane') as Entity;
    bgEl.classList.add('interactable');
    bgEl.setAttribute('data-no-dwell', 'true');
    bgEl.setAttribute('width', '0.56');
    bgEl.setAttribute('height', String(cardHeight));
    bgEl.setAttribute('material', 'shader: flat; color: #121316; opacity: 0.96; transparent: true');
    this.zonesCardEl.appendChild(bgEl);

    const titleEl = createTroikaText({
      position: `0 ${cardHeight / 2 - 0.032} 0.004`,
      value: PT_BR.zone.belt.feedback.zonesPickerTitle,
      color: '#F59E0B',
      fontSize: 0.018,
      maxWidth: 0.5,
    });
    this.zonesCardEl.appendChild(titleEl);

    options.forEach((opt, idx) => {
      const yOffset = cardHeight / 2 - 0.082 - idx * 0.058;
      const btn = document.createElement('a-plane') as Entity;
      btn.classList.add('interactable');
      btn.setAttribute('width', '0.5');
      btn.setAttribute('height', '0.048');
      btn.setAttribute('position', `0 ${yOffset} 0.008`);
      const isCurrent = opt.id === this.activeZoneId;
      btn.setAttribute(
        'material',
        `shader: flat; color: ${isCurrent ? '#1E3A8A' : '#1F2025'}; opacity: 0.96; transparent: true`,
      );
      btn.addEventListener('click', (event: Event) => {
        event.stopPropagation();
        this.activeZoneId = opt.id;
        this.zonesPickerOpen = false;
        this.beltController.setSubmenuOpen(false);
        this.zonesCardEl.setAttribute('visible', 'false');
        this.zonesCardEl.object3D.visible = false;
        const detail: SwitchZoneRequestDetail = { zoneId: opt.id };
        this.el.sceneEl.emit(ZONE_SWITCH_REQUEST_EVENT, detail);
        this.showToast(PT_BR.zone.belt.feedback.zoneSwitched(opt.name), 2000);
      });

      const txt = createTroikaText({
        position: '0 0 0.004',
        value: opt.name,
        color: '#F5F3EB',
        fontSize: 0.017,
        maxWidth: 0.46,
      });
      btn.appendChild(txt);
      this.zonesCardEl.appendChild(btn);
    });

    this.zonesCardEl.setAttribute('visible', 'true');
    this.zonesCardEl.object3D.visible = true;
    this.syncBeltVisuals();
  }

  private async populateContentsPicker(): Promise<void> {
    // submenu conteúdos com layout em grade (2x2), filtros por tipo de mídia, ícones phosphor e sincronização de estado (seção 4.3)
    while (this.zonesCardEl.firstChild) {
      this.zonesCardEl.removeChild(this.zonesCardEl.firstChild);
    }

    const pack =
      (await zoneStorage.loadStudyPack?.(this.activeZoneId)) ??
      resolveBundledDemoPack(this.activeZoneId);
    if (!pack) return;

    const sourceTitle = pack.sources[0]?.title ?? 'Material de estudo';
    const itemsByFilter: Record<VrContentsFilterTab, SubmenuContentGridItem[]> = {
      content: [],
      flashcards: [],
      quiz: [],
      studyObjects: [],
    };

    // 1. filtro Conteúdo (pdf enviado / fontes do documento)
    const storedPdf = await zoneStorage.loadPdfFile?.(this.activeZoneId);
    let sources = pack.sources;
    if (storedPdf) {
      const match = sources.find((s) => s.title === storedPdf.title);
      if (!match) {
        sources = [
          {
            id: storedPdf.sourceId,
            title: storedPdf.title,
            pageCount: pack.sources[0]?.pageCount ?? 4,
          },
          ...sources,
        ];
      }
    }
    if (sources.length === 0) {
      sources = [{ id: 'src-default', title: sourceTitle, pageCount: 4 }];
    }
    for (const src of sources) {
      itemsByFilter.content.push({
        contentId: `pdf-source-${src.id}`,
        kind: 'pdf',
        categoryLabel: PT_BR.zone.belt.contentFilters.content,
        title: src.title,
        pageCount: src.pageCount,
        accentColor: '#1E3A8A',
        icon: 'file-pdf',
        card: {
          id: `pdf-source-${src.id}`,
          title: src.title,
          body: `Documento completo (${src.pageCount} páginas)`,
          conceptIds: [],
          anchors: [{ sourceId: src.id, page: 1, chunkId: 'pdf-root' }],
        },
      });
    }

    // 2. filtro Flashcards (cartões extraídos + conceitos revisados)
    for (const card of pack.cards) {
      itemsByFilter.flashcards.push({
        contentId: `card-${card.id}`,
        kind: 'flashcard',
        categoryLabel: 'Flashcard',
        title: card.title,
        accentColor: '#0284C7',
        icon: 'cards',
        card,
      });
    }
    for (const concept of pack.concepts) {
      itemsByFilter.flashcards.push({
        contentId: `concept-${concept.id}`,
        kind: 'flashcard',
        categoryLabel: 'Conceito',
        title: concept.label,
        accentColor: '#1E3A8A',
        icon: 'brain',
        card: {
          id: `concept-${concept.id}`,
          title: concept.label,
          body: concept.definition,
          conceptIds: [concept.id],
          anchors: concept.anchors,
        },
      });
    }

    // 3. filtro Quiz (questões extraídas)
    pack.quiz.forEach((q, idx) => {
      const optionsText = q.options
        .map((opt, optIdx) => `${String.fromCharCode(65 + optIdx)}) ${opt}`)
        .join('\n');
      itemsByFilter.quiz.push({
        contentId: `quiz-${q.id}`,
        kind: 'quiz',
        categoryLabel: `Quiz #${idx + 1}`,
        title: q.prompt,
        accentColor: '#EA580C',
        icon: 'exam',
        card: {
          id: `quiz-${q.id}`,
          title: `Questão ${idx + 1}: ${q.prompt}`,
          body: `${optionsText}\n\nExplicação: ${q.explanation}`,
          conceptIds: q.conceptIds,
          anchors: q.anchors,
        },
      });
    });

    // 4. filtro Objetos de Estudo (ativos espaciais 3d)
    for (const asset of pack.assets) {
      const assetDetails =
        asset.kind === 'sequence-order'
          ? asset.steps.map((s, idx) => `${idx + 1}. ${s.text}`).join('\n')
          : asset.whySpatial;
      itemsByFilter.studyObjects.push({
        contentId: `asset-${asset.id}`,
        kind: 'study-object',
        categoryLabel: PT_BR.zone.belt.contentFilters.studyObjects,
        title: asset.title,
        accentColor: '#0284C7',
        icon: 'cube',
        card: {
          id: `asset-${asset.id}`,
          title: asset.title,
          body: `${asset.whySpatial}\n\n${assetDetails}`,
          conceptIds: [],
          anchors: [{ sourceId: sources[0]?.id ?? 'src-1', page: 1, chunkId: asset.id }],
        },
      });
    }

    const activeItems = itemsByFilter[this.contentsFilterTab];
    const pageSize = 4;
    const totalPages = Math.max(1, Math.ceil(activeItems.length / pageSize));
    const safePage = Math.max(0, Math.min(this.contentsPageIndex, totalPages - 1));
    this.contentsPageIndex = safePage;
    const slice = activeItems.slice(safePage * pageSize, (safePage + 1) * pageSize);

    const cardWidth = 0.78;
    const cardHeight = 0.44;

    // moldura externa de 1px estilo tech-brutalism
    const borderEl = document.createElement('a-plane') as Entity;
    borderEl.setAttribute('width', String(cardWidth + 0.008));
    borderEl.setAttribute('height', String(cardHeight + 0.008));
    borderEl.setAttribute('position', '0 0 -0.002');
    borderEl.setAttribute(
      'material',
      'shader: flat; color: #F5F3EB; opacity: 0.92; transparent: true',
    );
    this.zonesCardEl.appendChild(borderEl);

    const bgEl = document.createElement('a-plane') as Entity;
    bgEl.classList.add('interactable');
    bgEl.setAttribute('data-no-dwell', 'true');
    bgEl.setAttribute('width', String(cardWidth));
    bgEl.setAttribute('height', String(cardHeight));
    bgEl.setAttribute('material', 'shader: flat; color: #121316; opacity: 0.96; transparent: true');
    this.zonesCardEl.appendChild(bgEl);

    // cabeçalho do submenu
    const headerTitle = createTroikaText({
      position: `0 ${cardHeight / 2 - 0.028} 0.004`,
      value: `${PT_BR.zone.belt.feedback.contentsPickerTitle} (${safePage + 1}/${totalPages})`,
      color: '#F5F3EB',
      fontSize: 0.017,
      maxWidth: cardWidth - 0.06,
    });
    this.zonesCardEl.appendChild(headerTitle);

    // barra de filtros por tipo de mídia no topo do submenu (Conteúdo, Flashcards, Quiz, Objetos de Estudo)
    const filterTabs: { id: VrContentsFilterTab; label: string; color: string }[] = [
      {
        id: 'content',
        label: PT_BR.zone.belt.contentFilters.content,
        color: '#1E3A8A',
      },
      {
        id: 'flashcards',
        label: PT_BR.zone.belt.contentFilters.flashcards,
        color: '#0284C7',
      },
      {
        id: 'quiz',
        label: PT_BR.zone.belt.contentFilters.quiz,
        color: '#EA580C',
      },
      {
        id: 'studyObjects',
        label: PT_BR.zone.belt.contentFilters.studyObjects,
        color: '#0284C7',
      },
    ];

    const filterY = cardHeight / 2 - 0.072;
    const tabWidth = 0.174;
    const tabGap = 0.012;
    const totalTabsW = filterTabs.length * tabWidth + (filterTabs.length - 1) * tabGap;
    const startTabX = -totalTabsW / 2 + tabWidth / 2;

    filterTabs.forEach((tab, idx) => {
      const tabX = startTabX + idx * (tabWidth + tabGap);
      const isSelected = this.contentsFilterTab === tab.id;

      const tabBorder = document.createElement('a-plane') as Entity;
      tabBorder.setAttribute('width', String(tabWidth + 0.004));
      tabBorder.setAttribute('height', '0.044');
      tabBorder.setAttribute('position', `${tabX} ${filterY} 0.005`);
      tabBorder.setAttribute(
        'material',
        `shader: flat; color: ${isSelected ? '#F5F3EB' : tab.color}; opacity: 0.95; transparent: true`,
      );
      this.zonesCardEl.appendChild(tabBorder);

      const tabBtn = document.createElement('a-plane') as Entity;
      tabBtn.classList.add('interactable');
      tabBtn.setAttribute('width', String(tabWidth));
      tabBtn.setAttribute('height', '0.04');
      tabBtn.setAttribute('position', `${tabX} ${filterY} 0.007`);
      tabBtn.setAttribute(
        'material',
        `shader: flat; color: ${isSelected ? tab.color : '#1F2025'}; opacity: 0.96; transparent: true`,
      );
      tabBtn.addEventListener('click', (event: Event) => {
        event.stopPropagation();
        this.contentsFilterTab = tab.id;
        this.contentsPageIndex = 0;
        void this.populateContentsPicker();
      });

      const tabLabel = createTroikaText({
        position: '0 0 0.003',
        value: tab.label,
        color: '#F5F3EB',
        fontSize: 0.013,
        maxWidth: tabWidth - 0.01,
      });
      tabBtn.appendChild(tabLabel);
      this.zonesCardEl.appendChild(tabBtn);
    });

    // grade 2x2 de cartões de conteúdo
    const cellW = 0.345;
    const cellH = 0.105;
    const colOffsets = [-0.182, 0.182];
    const rowOffsets = [0.042, -0.078];

    slice.forEach((item, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const cellX = colOffsets[col] ?? 0;
      const cellY = rowOffsets[row] ?? 0;
      const isAlreadySpawned = this.activeSceneContentIds.has(item.contentId);
      const itemOpacity = isAlreadySpawned ? 0.3 : 0.96;

      const cellContainer = document.createElement('a-entity') as Entity;
      cellContainer.setAttribute('position', `${cellX} ${cellY} 0.008`);
      cellContainer.setAttribute('data-content-id', item.contentId);
      cellContainer.setAttribute('data-disabled', isAlreadySpawned ? 'true' : 'false');

      const cellBorder = document.createElement('a-plane') as Entity;
      cellBorder.setAttribute('width', String(cellW + 0.005));
      cellBorder.setAttribute('height', String(cellH + 0.005));
      cellBorder.setAttribute('position', '0 0 -0.001');
      cellBorder.setAttribute(
        'material',
        `shader: flat; color: ${isAlreadySpawned ? '#52525B' : item.accentColor}; opacity: ${itemOpacity}; transparent: true`,
      );
      cellContainer.appendChild(cellBorder);

      const cellBg = document.createElement('a-plane') as Entity;
      if (!isAlreadySpawned) {
        cellBg.classList.add('interactable');
      }
      cellBg.setAttribute('width', String(cellW));
      cellBg.setAttribute('height', String(cellH));
      cellBg.setAttribute(
        'material',
        `shader: flat; color: #18181B; opacity: ${itemOpacity}; transparent: true`,
      );

      if (!isAlreadySpawned) {
        cellBg.addEventListener('click', (event: Event) => {
          event.stopPropagation();
          const detail: AddContentRequestDetail = {
            contentId: item.contentId,
            kind: item.kind,
            card: item.card,
            sourceTitle: item.title,
            pageCount: item.pageCount,
            accentColor: item.accentColor,
            cameraYawDeg: this.lastCameraYawDeg,
          };
          this.el.sceneEl.emit(ZONE_ADD_CONTENT_REQUEST_EVENT, detail);
          this.showToast(PT_BR.zone.belt.feedback.contentAddedToPanel(item.title), 2200);
          void this.populateContentsPicker();
        });
      }
      cellContainer.appendChild(cellBg);

      // ícone phosphor da categoria à esquerda da célula da grade
      const iconEntity = createPhosphorIconEntity({
        icon: item.icon,
        color: isAlreadySpawned ? '#71717A' : item.accentColor,
        size: 0.028,
        position: `${-cellW / 2 + 0.028} 0.024 0.004`,
      });
      updatePhosphorIconAppearance(
        iconEntity,
        isAlreadySpawned ? '#71717A' : item.accentColor,
        itemOpacity,
      );
      cellContainer.appendChild(iconEntity);

      // badge da categoria ou estado [Na cena]
      const badgeText = isAlreadySpawned
        ? `${item.categoryLabel} (${PT_BR.zone.belt.feedback.contentAlreadyInScene})`
        : item.categoryLabel;
      const badgeEl = createTroikaText({
        position: `0.015 0.026 0.004`,
        value: badgeText,
        color: isAlreadySpawned ? '#71717A' : item.accentColor,
        fontSize: 0.012,
        maxWidth: cellW - 0.07,
      });
      cellContainer.appendChild(badgeEl);

      const shortTitle = item.title.length > 44 ? `${item.title.slice(0, 41)}...` : item.title;
      const titleEl = createTroikaText({
        position: `0 -0.014 0.004`,
        value: shortTitle,
        color: isAlreadySpawned ? '#71717A' : '#F5F3EB',
        fontSize: 0.014,
        maxWidth: cellW - 0.03,
      });
      cellContainer.appendChild(titleEl);

      this.zonesCardEl.appendChild(cellContainer);
    });

    // paginação na base da grade com ícones phosphor caret-left / caret-right
    if (totalPages > 1) {
      const navY = -cardHeight / 2 + 0.034;

      const prevBtn = document.createElement('a-plane') as Entity;
      prevBtn.classList.add('interactable');
      prevBtn.setAttribute('width', '0.22');
      prevBtn.setAttribute('height', '0.04');
      prevBtn.setAttribute('position', `-0.16 ${navY} 0.008`);
      prevBtn.setAttribute(
        'material',
        'shader: flat; color: #1F2025; opacity: 0.96; transparent: true',
      );
      prevBtn.addEventListener('click', (event: Event) => {
        event.stopPropagation();
        this.contentsPageIndex = (this.contentsPageIndex - 1 + totalPages) % totalPages;
        void this.populateContentsPicker();
      });
      prevBtn.appendChild(
        createPhosphorIconEntity({
          icon: 'caret-left',
          color: '#F5F3EB',
          size: 0.02,
          position: '-0.07 0 0.004',
        }),
      );
      prevBtn.appendChild(
        createTroikaText({
          position: '0.01 0 0.004',
          value: PT_BR.zone.belt.feedback.prevPage,
          color: '#F5F3EB',
          fontSize: 0.014,
          maxWidth: 0.16,
        }),
      );
      this.zonesCardEl.appendChild(prevBtn);

      const nextBtn = document.createElement('a-plane') as Entity;
      nextBtn.classList.add('interactable');
      nextBtn.setAttribute('width', '0.22');
      nextBtn.setAttribute('height', '0.04');
      nextBtn.setAttribute('position', `0.16 ${navY} 0.008`);
      nextBtn.setAttribute(
        'material',
        'shader: flat; color: #1F2025; opacity: 0.96; transparent: true',
      );
      nextBtn.addEventListener('click', (event: Event) => {
        event.stopPropagation();
        this.contentsPageIndex = (this.contentsPageIndex + 1) % totalPages;
        void this.populateContentsPicker();
      });
      nextBtn.appendChild(
        createPhosphorIconEntity({
          icon: 'caret-right',
          color: '#F5F3EB',
          size: 0.02,
          position: '0.07 0 0.004',
        }),
      );
      nextBtn.appendChild(
        createTroikaText({
          position: '-0.01 0 0.004',
          value: PT_BR.zone.belt.feedback.nextPage,
          color: '#F5F3EB',
          fontSize: 0.014,
          maxWidth: 0.16,
        }),
      );
      this.zonesCardEl.appendChild(nextBtn);
    }

    this.zonesCardEl.setAttribute('visible', 'true');
    this.zonesCardEl.object3D.visible = true;
    this.syncBeltVisuals();
  }

  private handlePomodoroEvents(events: PomodoroStepEvents): void {
    if (events.warningJustTriggered) {
      this.showToast(PT_BR.zone.pomodoro.oneMinWarning, 4000);
    }
    if (events.breakJustStarted) {
      const detail: PomodoroQuizRequestDetail = {
        cameraYawDeg: this.lastCameraYawDeg,
        completedBlocks: this.pomodoro.snapshot.completedBlocks,
      };
      this.el.sceneEl?.emit(ZONE_POMODORO_QUIZ_REQUEST_EVENT, detail);
    }
    if (events.breakJustStarted || events.breakJustEnded) {
      this.syncBreakScreenVisuals();
    }
  }

  private syncBeltVisuals(): void {
    const snap = this.beltController.snapshot;
    const shouldRender = snap.visible || snap.opacity > 0.01;
    this.beltGroupEl.setAttribute('visible', shouldRender ? 'true' : 'false');
    this.beltGroupEl.object3D.visible = shouldRender;
    if (!shouldRender) return;

    const palette = getThemePalette(this.currentTheme);
    const fadeFactor = snap.opacity;

    for (const btn of this.itemButtons) {
      const itemYaw = normalizeYawDeg(snap.beltYawDeg + btn.placement.yawOffsetDeg);
      const pos = sphericalToCartesian({
        yawDeg: itemYaw,
        pitchDeg: btn.placement.pitchDeg,
        radiusM: btn.placement.radiusM,
      });
      const rotX = panelFacingPitchDeg(btn.placement.pitchDeg);
      const rotY = panelFacingYawDeg(itemYaw);
      btn.containerEl.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);
      btn.containerEl.setAttribute('rotation', `${rotX} ${rotY} 0`);

      const isProm = btn.placement.prominent;
      const baseBgOp = isProm ? 0.96 : palette.beltButtonBgOpacity;
      const baseBorderOp = isProm ? 0.98 : palette.beltButtonBorderOpacity;
      const bgColor = isProm ? '#18181B' : palette.beltButtonBgColor;

      btn.bgEl.setAttribute(
        'material',
        `shader: flat; color: ${bgColor}; opacity: ${baseBgOp * fadeFactor}; transparent: true`,
      );

      if (btn.id === 'exit-zone') {
        const copy = PT_BR.zone.belt.items['exit-zone'];
        const label = snap.exitConfirmPending ? copy.confirmLabel : copy.label;
        const borderColor = snap.exitConfirmPending ? '#FB7185' : palette.beltButtonBorderColor;
        btn.borderEl.setAttribute(
          'material',
          `shader: flat; color: ${borderColor}; opacity: ${0.9 * fadeFactor}; transparent: true`,
        );
        updatePhosphorIconAppearance(
          btn.iconEl,
          snap.exitConfirmPending ? '#FB7185' : palette.beltIconColor,
          fadeFactor,
        );
        btn.labelEl.setAttribute('value', label);
        btn.labelEl.setAttribute('troika-text', 'value', label);
      } else {
        const borderColor = isProm ? '#EA580C' : palette.beltButtonBorderColor;
        btn.borderEl.setAttribute(
          'material',
          `shader: flat; color: ${borderColor}; opacity: ${baseBorderOp * fadeFactor}; transparent: true`,
        );
        updatePhosphorIconAppearance(
          btn.iconEl,
          isProm ? '#F59E0B' : palette.beltIconColor,
          fadeFactor,
        );
      }
    }

    const statusPitch = BELT_CENTER_PITCH_DEG + 10;
    const statusPos = sphericalToCartesian({
      yawDeg: snap.beltYawDeg,
      pitchDeg: statusPitch,
      radiusM: BELT_RADIUS_M,
    });
    this.statusPillEl.setAttribute('position', `${statusPos.x} ${statusPos.y} ${statusPos.z}`);
    this.statusPillEl.setAttribute(
      'rotation',
      `${panelFacingPitchDeg(statusPitch)} ${panelFacingYawDeg(snap.beltYawDeg)} 0`,
    );

    const statusMessage = this.computeStatusMessage();
    this.statusTextEl.setAttribute('value', statusMessage);
    this.statusTextEl.setAttribute('troika-text', 'value', statusMessage);

    if (this.zonesPickerOpen || this.contentsPickerOpen) {
      const pickerPitch = BELT_CENTER_PITCH_DEG + 22;
      const pickerPos = sphericalToCartesian({
        yawDeg: snap.beltYawDeg,
        pitchDeg: pickerPitch,
        radiusM: BELT_RADIUS_M - 0.06,
      });
      this.zonesCardEl.setAttribute('position', `${pickerPos.x} ${pickerPos.y} ${pickerPos.z}`);
      this.zonesCardEl.setAttribute(
        'rotation',
        `${panelFacingPitchDeg(pickerPitch)} ${panelFacingYawDeg(snap.beltYawDeg)} 0`,
      );
    }
  }

  private syncBreakScreenVisuals(): void {
    const pom = this.pomodoro.snapshot;
    const isBreak = pom.phase === 'break';
    this.breakCardEl.setAttribute('visible', isBreak ? 'true' : 'false');
    this.breakCardEl.object3D.visible = isBreak;
    if (!isBreak) return;

    const pos = sphericalToCartesian({
      yawDeg: this.lastCameraYawDeg,
      pitchDeg: 0,
      radiusM: 0.85,
    });
    this.breakCardEl.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);
    this.breakCardEl.setAttribute('rotation', `0 ${panelFacingYawDeg(this.lastCameraYawDeg)} 0`);
    const mmss = formatPomodoroMmSs(pom.remainingMs);
    const timerText = PT_BR.zone.pomodoro.breakTimer(mmss);
    this.breakTimerTextEl.setAttribute('value', timerText);
    this.breakTimerTextEl.setAttribute('troika-text', 'value', timerText);
  }

  private computeStatusMessage(): string {
    if (this.toastMessage) return this.toastMessage;
    const pom = this.pomodoro.snapshot;
    const mmss = formatPomodoroMmSs(pom.remainingMs);
    if (pom.phase === 'focus') {
      return PT_BR.zone.pomodoro.focusRunning(mmss);
    }
    if (pom.phase === 'paused') {
      return PT_BR.zone.pomodoro.focusPaused(mmss);
    }
    if (pom.phase === 'break') {
      return PT_BR.zone.pomodoro.breakTimer(mmss);
    }
    return PT_BR.zone.pomodoro.idle;
  }

  private showToast(message: string, durationMs: number): void {
    this.toastMessage = message;
    this.toastRemainingMs = durationMs;
  }

  private async performExitZone(): Promise<void> {
    try {
      this.el.sceneEl?.emit(ZONE_EXIT_FINALIZE_EVENT, {
        completedBlocks: this.pomodoro.snapshot.completedBlocks,
      });
      await zoneStorage.saveSessionState?.({
        zoneId: this.activeZoneId,
        completedPomodoroBlocks: this.pomodoro.snapshot.completedBlocks,
        exitedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.warn('failed to save session state before exiting zone', error);
    }
    window.location.assign('/index.html');
  }

  private readCurrentHoveredElement(): Entity | null {
    const cameraEl = this.el.sceneEl.querySelector<Entity>(this.data.cameraSelector);
    const cursor = cameraEl?.components['ixr-cursor'] as CursorComponent | undefined;
    return cursor?.controller?.getHoveredElement() ?? null;
  }

  private readCameraSphericalAngles(): { yawDeg: number; pitchDeg: number } | null {
    const cameraEl = this.el.sceneEl.querySelector<Entity>(this.data.cameraSelector);
    const cameraObj = cameraEl?.getObject3D('camera') ?? cameraEl?.object3D;
    if (!cameraObj) return null;
    cameraObj.getWorldDirection(this.forwardVec);
    return directionToSphericalAngles(this.forwardVec);
  }
}

AFRAME.registerComponent<BeltMenuComponent>('imx-belt-menu', {
  schema: {
    cameraSelector: { type: 'string', default: '#main-camera' },
    zoneId: { type: 'string', default: DEFAULT_DEMO_ZONE_ID },
    pomodoroPreset: { type: 'string', default: DEFAULT_POMODORO_PRESET },
  },
  init() {
    this.controller = new BeltMenuBridge(this.el, this.data);
  },
  update() {
    this.controller?.updateData(this.data);
  },
  tick(_time, timeDelta) {
    this.controller?.tick(timeDelta);
  },
  remove() {
    this.controller?.dispose();
  },
});
