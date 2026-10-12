import AFRAME, { type Component, type Entity } from 'aframe';

import { PT_BR } from '../../shared/i18n/pt-br';
import { logger } from '../../shared/logger';
import { zoneStorage } from '../../shared/storage/dexie-db';
import type { Zone } from '../../shared/types/zone';
import type { ModeComponent } from './imx-mode';
import {
  ZONE_RECENTER_REQUEST_EVENT,
  ZONE_SWITCH_REQUEST_EVENT,
  type RecenterRequestDetail,
  type SwitchZoneRequestDetail,
} from './zone-workspace';
import {
  BELT_CENTER_PITCH_DEG,
  BELT_ITEM_HEIGHT_M,
  BELT_ITEM_WIDTH_M,
  BELT_RADIUS_M,
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
import '../systems/rounded-shape';
import {
  BeltMenuController,
  computeBeltItemPlacements,
  normalizeYawDeg,
  type BeltItemId,
  type BeltItemPlacement,
} from '../systems/belt-controller';
import {
  getThemePalette,
  resolveInitialTheme,
  toggleTheme,
  ZONE_THEME_CHANGE_EVENT,
  ZONE_THEME_STORAGE_KEY,
} from '../systems/theme-controller';
import {
  formatPomodoroMmSs,
  PomodoroSystem,
  type PomodoroStepEvents,
} from '../systems/pomodoro-system';
import {
  directionToSphericalAngles,
  panelFacingPitchDeg,
  panelFacingYawDeg,
  sphericalToCartesian,
} from '../systems/spherical';

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
  readonly containerEl: Entity;
  readonly bgEl: Entity;
  readonly borderEl: Entity;
  readonly iconEl: Entity;
  readonly labelEl: Entity;
}

function createTroikaText(options: {
  position: string;
  value: string;
  color: string;
  fontSize: number;
  maxWidth: number;
  lineHeight?: number;
}): Entity {
  const el = document.createElement('a-troika-text') as Entity;
  const lineH = options.lineHeight ?? 1.2;
  el.setAttribute('position', options.position);
  el.setAttribute('value', options.value);
  el.setAttribute('color', options.color);
  el.setAttribute('align', 'center');
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
    `value: ${options.value}; color: ${options.color}; fontSize: ${options.fontSize}; maxWidth: ${options.maxWidth}; lineHeight: ${lineH}; align: center; anchor: center; baseline: center`,
  );
  return el;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

// integra o BeltMenuController e o PomodoroSystem à cena a-frame com atalhos Esc, Z, M, P, C
export class BeltMenuBridge {
  readonly beltController = new BeltMenuController();
  readonly pomodoro: PomodoroSystem;

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
  private activeZoneId: string;
  private currentTheme: ZoneTheme;
  private statusBorderEl: Entity | null = null;
  private statusBgEl: Entity | null = null;

  private readonly onThemeChange = (event: Event): void => {
    const detail = (event as CustomEvent<{ theme: ZoneTheme }>).detail;
    if (detail?.theme && detail.theme !== this.currentTheme) {
      this.currentTheme = detail.theme;
      this.applyTheme(detail.theme);
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

    const angles = this.readCameraSphericalAngles();
    if (angles) {
      this.lastCameraYawDeg = angles.yawDeg;
      const prevVisible = this.beltController.snapshot.visible;
      const snap = this.beltController.update(angles.yawDeg, angles.pitchDeg, dt);
      if (prevVisible && !snap.visible) {
        this.zonesPickerOpen = false;
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
        this.zonesPickerOpen = !this.zonesPickerOpen;
        if (this.zonesPickerOpen) {
          void this.populateZonesPicker();
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
      case 'ai-assistant': {
        this.showToast(PT_BR.zone.belt.feedback.aiDisabled, 2500);
        break;
      }
    }
    this.syncBeltVisuals();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
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

    // pílula de status acima do arco do cinto com cantos arredondados
    const statusPalette = getThemePalette(this.currentTheme);
    this.statusBorderEl = document.createElement('a-entity') as Entity;
    this.statusBorderEl.setAttribute(
      'geometry',
      'primitive: rounded-rect; width: 0.53; height: 0.074; radius: 0.037',
    );
    this.statusBorderEl.setAttribute('position', '0 0 -0.001');
    this.statusBorderEl.setAttribute(
      'material',
      'shader: flat; color: #FFFFFF; opacity: 0.85; transparent: true',
    );
    this.statusPillEl.appendChild(this.statusBorderEl);

    this.statusBgEl = document.createElement('a-entity') as Entity;
    this.statusBgEl.setAttribute(
      'geometry',
      'primitive: rounded-rect; width: 0.52; height: 0.064; radius: 0.032',
    );
    this.statusBgEl.setAttribute('position', '0 0 0');
    this.statusBgEl.setAttribute(
      'material',
      `shader: flat; color: ${statusPalette.statusPillBgColor}; opacity: 0.85; transparent: true`,
    );
    this.statusPillEl.appendChild(this.statusBgEl);

    this.statusTextEl = createTroikaText({
      position: '0 0 0.004',
      value: PT_BR.zone.pomodoro.idle,
      color: statusPalette.statusPillTextColor,
      fontSize: 0.02,
      maxWidth: 0.48,
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
    const isDisabled = placement.disabled;
    const palette = getThemePalette(this.currentTheme);
    const stroke = 0.005;

    const borderEl = document.createElement('a-entity') as Entity;
    borderEl.setAttribute('geometry', {
      primitive: 'rounded-rect',
      width: BELT_ITEM_WIDTH_M + 2 * stroke,
      height: BELT_ITEM_HEIGHT_M + 2 * stroke,
      radius: 0.022 + stroke,
    });
    borderEl.setAttribute('position', '0 0 -0.002');
    borderEl.setAttribute(
      'material',
      `shader: flat; color: ${isDisabled ? '#475569' : palette.beltButtonBorderColor}; opacity: ${isDisabled ? 0.5 : palette.beltButtonBorderOpacity}; transparent: true`,
    );
    containerEl.appendChild(borderEl);

    const bgEl = document.createElement('a-entity') as Entity;
    bgEl.classList.add('interactable');
    bgEl.setAttribute('geometry', {
      primitive: 'rounded-rect',
      width: BELT_ITEM_WIDTH_M,
      height: BELT_ITEM_HEIGHT_M,
      radius: 0.02,
    });
    bgEl.setAttribute('position', '0 0 0.002');
    bgEl.setAttribute(
      'material',
      `shader: flat; color: ${isDisabled ? '#334155' : palette.beltButtonBgColor}; opacity: ${isDisabled ? 0.6 : palette.beltButtonBgOpacity}; transparent: true`,
    );
    bgEl.addEventListener('click', (event: Event) => {
      event.stopPropagation();
      this.executeAction(placement.id);
    });
    containerEl.appendChild(bgEl);

    const copy = PT_BR.zone.belt.items[placement.id];
    const iconColor = isDisabled ? '#94A3B8' : palette.beltIconColor;
    const iconEl = createTroikaText({
      position: '0 0.022 0.006',
      value: copy.icon,
      color: iconColor,
      fontSize: 0.042,
      maxWidth: BELT_ITEM_WIDTH_M - 0.015,
    });
    containerEl.appendChild(iconEl);

    const labelColor = isDisabled ? '#94A3B8' : palette.beltLabelColor;
    const labelEl = createTroikaText({
      position: '0 -0.032 0.006',
      value: copy.label,
      color: labelColor,
      fontSize: 0.02,
      maxWidth: BELT_ITEM_WIDTH_M - 0.012,
    });
    containerEl.appendChild(labelEl);

    const refs: BeltButtonRefs = {
      id: placement.id,
      placement,
      containerEl,
      bgEl,
      borderEl,
      iconEl,
      labelEl,
    };

    bgEl.addEventListener('mouseenter', () => this.setButtonHighlight(refs, true));
    bgEl.addEventListener('mouseleave', () => this.setButtonHighlight(refs, false));

    return refs;
  }

  private setButtonHighlight(btn: BeltButtonRefs, active: boolean): void {
    if (btn.placement.disabled) return;
    const palette = getThemePalette(this.currentTheme);
    const stroke = active ? 0.01 : 0.005;
    const opacity = active ? 1.0 : palette.beltButtonBorderOpacity;
    btn.borderEl.setAttribute('geometry', {
      primitive: 'rounded-rect',
      width: BELT_ITEM_WIDTH_M + 2 * stroke,
      height: BELT_ITEM_HEIGHT_M + 2 * stroke,
      radius: 0.022 + stroke,
    });
    btn.borderEl.setAttribute(
      'material',
      `shader: flat; color: #FFFFFF; opacity: ${opacity}; transparent: true`,
    );
  }

  applyTheme(theme: ZoneTheme): void {
    this.currentTheme = theme;
    const palette = getThemePalette(theme);

    for (const btn of this.itemButtons) {
      const isDis = btn.placement.disabled;
      btn.borderEl.setAttribute(
        'material',
        `shader: flat; color: ${isDis ? '#475569' : palette.beltButtonBorderColor}; opacity: ${isDis ? 0.5 : palette.beltButtonBorderOpacity}; transparent: true`,
      );
      btn.bgEl.setAttribute(
        'material',
        `shader: flat; color: ${isDis ? '#334155' : palette.beltButtonBgColor}; opacity: ${isDis ? 0.6 : palette.beltButtonBgOpacity}; transparent: true`,
      );
      btn.iconEl.setAttribute('color', isDis ? '#94A3B8' : palette.beltIconColor);
      btn.iconEl.setAttribute('troika-text', 'color', isDis ? '#94A3B8' : palette.beltIconColor);
      btn.labelEl.setAttribute('color', isDis ? '#94A3B8' : palette.beltLabelColor);
      btn.labelEl.setAttribute('troika-text', 'color', isDis ? '#94A3B8' : palette.beltLabelColor);
    }

    this.statusBorderEl?.setAttribute(
      'material',
      'shader: flat; color: #FFFFFF; opacity: 0.85; transparent: true',
    );
    this.statusBgEl?.setAttribute(
      'material',
      `shader: flat; color: ${palette.statusPillBgColor}; opacity: 0.85; transparent: true`,
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
      'shader: flat; color: #FFFFFF; opacity: 0.85; transparent: true',
    );
    this.breakCardEl.appendChild(borderEl);

    const bgEl = document.createElement('a-entity') as Entity;
    bgEl.setAttribute(
      'geometry',
      'primitive: rounded-rect; width: 0.58; height: 0.34; radius: 0.028',
    );
    bgEl.setAttribute('material', 'shader: flat; color: #0F172A; opacity: 0.95; transparent: true');
    this.breakCardEl.appendChild(bgEl);

    const titleEl = createTroikaText({
      position: '0 0.1 0.005',
      value: PT_BR.zone.pomodoro.breakTitle,
      color: '#34D399',
      fontSize: 0.024,
      maxWidth: 0.5,
    });
    this.breakCardEl.appendChild(titleEl);

    const bodyEl = createTroikaText({
      position: '0 0.02 0.005',
      value: PT_BR.zone.pomodoro.breakBody,
      color: '#E2E8F0',
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
    skipBtn.setAttribute('width', '0.26');
    skipBtn.setAttribute('height', '0.06');
    skipBtn.setAttribute('position', '0 -0.115 0.01');
    skipBtn.setAttribute(
      'material',
      'shader: flat; color: #1E293B; opacity: 0.96; transparent: true',
    );
    skipBtn.addEventListener('click', (event: Event) => {
      event.stopPropagation();
      this.pomodoro.skipBreak();
      this.syncBreakScreenVisuals();
    });

    const skipLabel = createTroikaText({
      position: '0 0 0.004',
      value: PT_BR.zone.pomodoro.skipBreakButton,
      color: '#34D399',
      fontSize: 0.018,
      maxWidth: 0.24,
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

    const cardHeight = 0.09 + options.length * 0.06;
    const bgEl = document.createElement('a-plane') as Entity;
    bgEl.setAttribute('width', '0.5');
    bgEl.setAttribute('height', String(cardHeight));
    bgEl.setAttribute('material', 'shader: flat; color: #0F172A; opacity: 0.95; transparent: true');
    this.zonesCardEl.appendChild(bgEl);

    const titleEl = createTroikaText({
      position: `0 ${cardHeight / 2 - 0.032} 0.004`,
      value: PT_BR.zone.belt.feedback.zonesPickerTitle,
      color: '#38BDF8',
      fontSize: 0.018,
      maxWidth: 0.46,
    });
    this.zonesCardEl.appendChild(titleEl);

    options.forEach((opt, idx) => {
      const yOffset = cardHeight / 2 - 0.08 - idx * 0.056;
      const btn = document.createElement('a-plane') as Entity;
      btn.classList.add('interactable');
      btn.setAttribute('width', '0.45');
      btn.setAttribute('height', '0.048');
      btn.setAttribute('position', `0 ${yOffset} 0.008`);
      const isCurrent = opt.id === this.activeZoneId;
      btn.setAttribute(
        'material',
        `shader: flat; color: ${isCurrent ? '#1E3A8A' : '#1E293B'}; opacity: 0.95; transparent: true`,
      );
      btn.addEventListener('click', (event: Event) => {
        event.stopPropagation();
        this.activeZoneId = opt.id;
        this.zonesPickerOpen = false;
        this.zonesCardEl.setAttribute('visible', 'false');
        this.zonesCardEl.object3D.visible = false;
        const detail: SwitchZoneRequestDetail = { zoneId: opt.id };
        this.el.sceneEl.emit(ZONE_SWITCH_REQUEST_EVENT, detail);
        this.showToast(PT_BR.zone.belt.feedback.zoneSwitched(opt.name), 2000);
      });

      const txt = createTroikaText({
        position: '0 0 0.004',
        value: opt.name,
        color: '#F8FAFC',
        fontSize: 0.017,
        maxWidth: 0.42,
      });
      btn.appendChild(txt);
      this.zonesCardEl.appendChild(btn);
    });

    this.zonesCardEl.setAttribute('visible', 'true');
    this.zonesCardEl.object3D.visible = true;
    this.syncBeltVisuals();
  }

  private handlePomodoroEvents(events: PomodoroStepEvents): void {
    if (events.warningJustTriggered) {
      this.showToast(PT_BR.zone.pomodoro.oneMinWarning, 4000);
    }
    if (events.breakJustStarted || events.breakJustEnded) {
      this.syncBreakScreenVisuals();
    }
  }

  private syncBeltVisuals(): void {
    const snap = this.beltController.snapshot;
    this.beltGroupEl.setAttribute('visible', snap.visible ? 'true' : 'false');
    this.beltGroupEl.object3D.visible = snap.visible;
    if (!snap.visible) return;

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

      if (btn.id === 'exit-zone') {
        const copy = PT_BR.zone.belt.items['exit-zone'];
        const label = snap.exitConfirmPending ? copy.confirmLabel : copy.label;
        const borderColor = snap.exitConfirmPending ? '#F87171' : '#38BDF8';
        btn.borderEl.setAttribute(
          'material',
          `shader: flat; color: ${borderColor}; opacity: 0.85; transparent: true`,
        );
        btn.iconEl.setAttribute('color', borderColor);
        btn.iconEl.setAttribute('troika-text', 'color', borderColor);
        btn.labelEl.setAttribute('value', label);
        btn.labelEl.setAttribute('troika-text', 'value', label);
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

    if (this.zonesPickerOpen) {
      const pickerPitch = BELT_CENTER_PITCH_DEG + 17;
      const pickerPos = sphericalToCartesian({
        yawDeg: snap.beltYawDeg,
        pitchDeg: pickerPitch,
        radiusM: BELT_RADIUS_M - 0.05,
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
