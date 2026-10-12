import AFRAME, { type Component, type Entity } from 'aframe';
import type { CursorComponent, CursorHoverDetail } from 'interacxr';

import { PT_BR } from '../../shared/i18n/pt-br';
import type { PanelLayout } from '../../shared/types/zone';
import {
  HANDLE_HOVER_REVEAL_MS,
  PANEL_BUTTON_SIZE_M,
  PANEL_DEFAULT_HEIGHT_M,
  PANEL_DEFAULT_WIDTH_M,
  PANEL_HANDLE_HEIGHT_M,
  PANEL_HANDLE_WIDTH_M,
  type ZoneTheme,
} from '../config/constants';
import { DragHandleStateMachine } from '../systems/dwell-controller';
import '../systems/rounded-shape';
import {
  calcHandleBarScale,
  clampSpherical,
  cycleRadius,
  directionToSphericalAngles,
  resolvePanelPlacement,
} from '../systems/spherical';
import {
  getThemePalette,
  resolveInitialTheme,
  ZONE_THEME_CHANGE_EVENT,
  ZONE_THEME_STORAGE_KEY,
} from '../systems/theme-controller';
import type { PanelComponent } from './imx-panel';

export const PANEL_DROP_EVENT = 'imx-panel-drop';

interface DragHandleData {
  cameraSelector: string;
  hoverRevealMs: number;
  width: number;
  height: number;
}

export interface DragHandleComponent extends Component<DragHandleData> {
  controller?: DragHandleController;
}

function createSubEntity(tag: string, attributes: Record<string, unknown>): Entity {
  const el = document.createElement(tag) as Entity;
  for (const [key, value] of Object.entries(attributes)) {
    el.setAttribute(key, value);
  }
  return el;
}

// alça de arraste de 6 pontos (2x3) com cantos arredondados, feedback de borda branca e botões -/+
export class DragHandleController {
  readonly state: DragHandleStateMachine;
  private readonly barRootEl: Entity;
  private readonly handleBorderEl: Entity;
  private readonly handleEl: Entity;
  private readonly dotEls: Entity[] = [];
  private readonly minusBorderEl: Entity;
  private readonly minusBtnEl: Entity;
  private readonly minusTextEl: Entity;
  private readonly plusBorderEl: Entity;
  private readonly plusBtnEl: Entity;
  private readonly plusTextEl: Entity;
  private readonly cameraDirection = new AFRAME.THREE.Vector3();
  private lastVisibleState: boolean | null = null;
  private lastBarScale = -1;
  private currentTheme: ZoneTheme;

  private readonly onThemeChange = (event: Event): void => {
    const detail = (event as CustomEvent<{ theme: ZoneTheme }>).detail;
    if (detail?.theme) {
      this.applyTheme(detail.theme);
    }
  };

  private readonly onHoverStart = (event: Event): void => {
    const hovered = (event as CustomEvent<CursorHoverDetail>).detail.el;
    if (this.belongsToPanel(hovered)) {
      this.state.setPanelHovered(true);
    }
  };

  private readonly onHoverEnd = (): void => {
    const hovered = this.currentHoveredElement();
    if (!this.belongsToPanel(hovered)) {
      this.state.setPanelHovered(false);
      this.syncHandleVisibility();
    }
  };

  private readonly onGrabStart = (): void => {
    const hovered = this.currentHoveredElement();
    if (hovered === this.handleEl && this.state.isHandleVisible && this.state.startGrabDrag()) {
      this.panelController()?.setHighlight(true);
      this.setHandleHighlight(true);
      this.syncHandleVisibility();
    }
  };

  private readonly onGrabEnd = (): void => {
    if (this.state.endGrabDrag()) {
      this.setHandleHighlight(false);
      this.finishDrop();
    }
  };

  // botão '-' afasta o painel (aumenta radiusM, diminuindo o tamanho aparente)
  private readonly onMinusClick = (): void => {
    this.changeRadius(1);
  };

  // botão '+' aproxima o painel do rosto (reduz radiusM, aumentando o tamanho aparente)
  private readonly onPlusClick = (): void => {
    this.changeRadius(-1);
  };

  constructor(
    private readonly el: Entity,
    private data: DragHandleData,
  ) {
    this.state = new DragHandleStateMachine(data.hoverRevealMs);

    let storedPref: string | null = null;
    try {
      storedPref = localStorage.getItem(ZONE_THEME_STORAGE_KEY);
    } catch {
      // ignora caso localStorage não esteja acessível
    }
    this.currentTheme = resolveInitialTheme(storedPref);
    const palette = getThemePalette(this.currentTheme);

    const topY = data.height / 2 + PANEL_HANDLE_HEIGHT_M / 2 + 0.012;
    this.barRootEl = createSubEntity('a-entity', {
      position: `0 ${topY} 0.012`,
      visible: false,
    });

    const hBorderStroke = 0.004;
    this.handleBorderEl = createSubEntity('a-entity', {
      geometry: `primitive: rounded-rect; width: ${PANEL_HANDLE_WIDTH_M + 2 * hBorderStroke}; height: ${PANEL_HANDLE_HEIGHT_M + 2 * hBorderStroke}; radius: ${0.016 + hBorderStroke}`,
      position: '0 0 -0.001',
      material: `color: ${palette.handleBorderColor}; shader: flat; opacity: 0.85; transparent: true`,
    });

    this.handleEl = createSubEntity('a-entity', {
      class: 'interactable',
      geometry: `primitive: rounded-rect; width: ${PANEL_HANDLE_WIDTH_M}; height: ${PANEL_HANDLE_HEIGHT_M}; radius: 0.016`,
      position: '0 0 0',
      material: `color: ${palette.handleBgColor}; shader: flat; opacity: ${palette.handleBgOpacity}; transparent: true`,
    });

    const cols = [-0.013, 0.013];
    const rows = [0.015, 0, -0.015];
    for (const x of cols) {
      for (const y of rows) {
        const dot = createSubEntity('a-circle', {
          radius: 0.0045,
          position: `${x} ${y} 0.003`,
          material: `color: ${palette.handleDotsColor}; shader: flat`,
        });
        this.dotEls.push(dot);
        this.handleEl.appendChild(dot);
      }
    }

    const sideOffset = PANEL_HANDLE_WIDTH_M / 2 + PANEL_BUTTON_SIZE_M / 2 + 0.016;

    const bStroke = 0.004;
    this.minusBorderEl = createSubEntity('a-entity', {
      geometry: `primitive: rounded-rect; width: ${PANEL_BUTTON_SIZE_M + 2 * bStroke}; height: ${PANEL_HANDLE_HEIGHT_M + 2 * bStroke}; radius: ${0.014 + bStroke}`,
      position: `${-sideOffset} 0 -0.001`,
      material: `color: ${palette.buttonBorderColor}; shader: flat; opacity: 0.85; transparent: true`,
    });
    this.minusBtnEl = createSubEntity('a-entity', {
      class: 'interactable',
      geometry: `primitive: rounded-rect; width: ${PANEL_BUTTON_SIZE_M}; height: ${PANEL_HANDLE_HEIGHT_M}; radius: 0.014`,
      position: `${-sideOffset} 0 0`,
      material: `color: ${palette.buttonBgColor}; shader: flat; opacity: ${palette.buttonBgOpacity}; transparent: true`,
    });
    this.minusTextEl = createSubEntity('a-troika-text', {
      position: '0 0 0.003',
      align: 'center',
      anchor: 'center',
      baseline: 'center',
      color: palette.buttonTextColor,
      'font-size': 0.024,
      fontSize: 0.024,
      value: PT_BR.zone.panels.radiusNearer,
      'troika-text': `value: ${PT_BR.zone.panels.radiusNearer}; fontSize: 0.024; color: ${palette.buttonTextColor}; align: center; anchor: center; baseline: center`,
    });
    this.minusBtnEl.appendChild(this.minusTextEl);

    this.plusBorderEl = createSubEntity('a-entity', {
      geometry: `primitive: rounded-rect; width: ${PANEL_BUTTON_SIZE_M + 2 * bStroke}; height: ${PANEL_HANDLE_HEIGHT_M + 2 * bStroke}; radius: ${0.014 + bStroke}`,
      position: `${sideOffset} 0 -0.001`,
      material: `color: ${palette.buttonBorderColor}; shader: flat; opacity: 0.85; transparent: true`,
    });
    this.plusBtnEl = createSubEntity('a-entity', {
      class: 'interactable',
      geometry: `primitive: rounded-rect; width: ${PANEL_BUTTON_SIZE_M}; height: ${PANEL_HANDLE_HEIGHT_M}; radius: 0.014`,
      position: `${sideOffset} 0 0`,
      material: `color: ${palette.buttonBgColor}; shader: flat; opacity: ${palette.buttonBgOpacity}; transparent: true`,
    });
    this.plusTextEl = createSubEntity('a-troika-text', {
      position: '0 0 0.003',
      align: 'center',
      anchor: 'center',
      baseline: 'center',
      color: palette.buttonTextColor,
      'font-size': 0.024,
      fontSize: 0.024,
      value: PT_BR.zone.panels.radiusFarther,
      'troika-text': `value: ${PT_BR.zone.panels.radiusFarther}; fontSize: 0.024; color: ${palette.buttonTextColor}; align: center; anchor: center; baseline: center`,
    });
    this.plusBtnEl.appendChild(this.plusTextEl);

    this.barRootEl.appendChild(this.minusBorderEl);
    this.barRootEl.appendChild(this.minusBtnEl);
    this.barRootEl.appendChild(this.handleBorderEl);
    this.barRootEl.appendChild(this.handleEl);
    this.barRootEl.appendChild(this.plusBorderEl);
    this.barRootEl.appendChild(this.plusBtnEl);
    this.el.appendChild(this.barRootEl);

    this.minusBtnEl.addEventListener('click', this.onMinusClick);
    this.plusBtnEl.addEventListener('click', this.onPlusClick);

    const cameraEl = this.cameraEntity();
    cameraEl?.addEventListener('ixr-cursor-hover-start', this.onHoverStart);
    cameraEl?.addEventListener('ixr-cursor-hover-end', this.onHoverEnd);
    cameraEl?.addEventListener('ixr-grab-start', this.onGrabStart);
    cameraEl?.addEventListener('ixr-grab-end', this.onGrabEnd);
    cameraEl?.addEventListener('ixr-hand-lost', this.onGrabEnd);

    window.addEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);

    this.syncHandleBarScale();
  }

  tick(deltaMs: number): void {
    this.state.stepHover(deltaMs);
    this.syncHandleVisibility();
    this.syncHandleBarScale();
    if (this.state.isDragging) {
      this.followCursorOnSphere();
    }
  }

  dispose(): void {
    window.removeEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
    const cameraEl = this.cameraEntity();
    cameraEl?.removeEventListener('ixr-cursor-hover-start', this.onHoverStart);
    cameraEl?.removeEventListener('ixr-cursor-hover-end', this.onHoverEnd);
    cameraEl?.removeEventListener('ixr-grab-start', this.onGrabStart);
    cameraEl?.removeEventListener('ixr-grab-end', this.onGrabEnd);
    cameraEl?.removeEventListener('ixr-hand-lost', this.onGrabEnd);
    this.minusBtnEl.removeEventListener('click', this.onMinusClick);
    this.plusBtnEl.removeEventListener('click', this.onPlusClick);
    this.barRootEl.remove();
  }

  setHandleHighlight(active: boolean): void {
    const stroke = active ? 0.008 : 0.004;
    const opacity = active ? 1.0 : 0.85;
    this.handleBorderEl.setAttribute('geometry', {
      primitive: 'rounded-rect',
      width: PANEL_HANDLE_WIDTH_M + 2 * stroke,
      height: PANEL_HANDLE_HEIGHT_M + 2 * stroke,
      radius: 0.016 + stroke,
    });
    this.handleBorderEl.setAttribute(
      'material',
      `color: #FFFFFF; shader: flat; opacity: ${opacity}; transparent: true`,
    );
  }

  applyTheme(theme: ZoneTheme): void {
    this.currentTheme = theme;
    const palette = getThemePalette(theme);

    this.handleEl.setAttribute(
      'material',
      `color: ${palette.handleBgColor}; shader: flat; opacity: ${palette.handleBgOpacity}; transparent: true`,
    );
    this.handleBorderEl.setAttribute(
      'material',
      `color: ${palette.handleBorderColor}; shader: flat; opacity: 0.85; transparent: true`,
    );
    for (const dot of this.dotEls) {
      dot.setAttribute('material', `color: ${palette.handleDotsColor}; shader: flat`);
    }

    this.minusBtnEl.setAttribute(
      'material',
      `color: ${palette.buttonBgColor}; shader: flat; opacity: ${palette.buttonBgOpacity}; transparent: true`,
    );
    this.minusBorderEl.setAttribute(
      'material',
      `color: ${palette.buttonBorderColor}; shader: flat; opacity: 0.85; transparent: true`,
    );
    this.minusTextEl.setAttribute('color', palette.buttonTextColor);
    this.minusTextEl.setAttribute('troika-text', 'color', palette.buttonTextColor);

    this.plusBtnEl.setAttribute(
      'material',
      `color: ${palette.buttonBgColor}; shader: flat; opacity: ${palette.buttonBgOpacity}; transparent: true`,
    );
    this.plusBorderEl.setAttribute(
      'material',
      `color: ${palette.buttonBorderColor}; shader: flat; opacity: 0.85; transparent: true`,
    );
    this.plusTextEl.setAttribute('color', palette.buttonTextColor);
    this.plusTextEl.setAttribute('troika-text', 'color', palette.buttonTextColor);
  }

  private cameraEntity(): Entity | null {
    return this.el.sceneEl.querySelector<Entity>(this.data.cameraSelector);
  }

  private currentHoveredElement(): Entity | null {
    const cameraEl = this.cameraEntity();
    const cursor = cameraEl?.components['ixr-cursor'] as CursorComponent | undefined;
    return cursor?.controller?.getHoveredElement() ?? null;
  }

  private belongsToPanel(target: Entity | null): boolean {
    if (!target) return false;
    return target === this.el || this.el.contains(target);
  }

  private panelController() {
    const panel = this.el.components['imx-panel'] as PanelComponent | undefined;
    return panel?.controller ?? null;
  }

  private syncHandleVisibility(): void {
    const visible = this.state.isHandleVisible;
    if (visible === this.lastVisibleState) return;
    this.lastVisibleState = visible;
    this.barRootEl.setAttribute('visible', visible);
  }

  private syncHandleBarScale(): void {
    const panelCtrl = this.panelController();
    const radiusM = panelCtrl?.spherical.radiusM ?? 1.5;
    const scale = calcHandleBarScale(radiusM);
    if (scale === this.lastBarScale) return;
    this.lastBarScale = scale;
    const topY = this.data.height / 2 + (PANEL_HANDLE_HEIGHT_M * scale) / 2 + 0.012;
    this.barRootEl.setAttribute('position', `0 ${topY} 0.012`);
    this.barRootEl.setAttribute('scale', `${scale} ${scale} 1`);
  }

  private followCursorOnSphere(): void {
    const cameraEl = this.cameraEntity();
    const cameraObj = cameraEl?.getObject3D('camera');
    const panelCtrl = this.panelController();
    if (!cameraObj || !panelCtrl) return;

    cameraObj.getWorldDirection(this.cameraDirection);
    const angles = directionToSphericalAngles(this.cameraDirection);
    const clamped = clampSpherical({
      yawDeg: angles.yawDeg,
      pitchDeg: angles.pitchDeg,
      radiusM: panelCtrl.spherical.radiusM,
    });
    panelCtrl.setSpherical(clamped);
  }

  private changeRadius(direction: -1 | 1): void {
    const panelCtrl = this.panelController();
    if (!panelCtrl) return;
    const current = panelCtrl.spherical;
    const nextRadius = cycleRadius(current.radiusM, direction);
    if (nextRadius === current.radiusM) return;
    panelCtrl.setSpherical({
      yawDeg: current.yawDeg,
      pitchDeg: current.pitchDeg,
      radiusM: nextRadius,
    });
    this.syncHandleBarScale();
    const detail: PanelLayout = {
      panelId: panelCtrl.panelId,
      yawDeg: panelCtrl.spherical.yawDeg,
      pitchDeg: panelCtrl.spherical.pitchDeg,
      radiusM: panelCtrl.spherical.radiusM,
    };
    this.el.sceneEl.emit(PANEL_DROP_EVENT, detail);
  }

  private finishDrop(): void {
    const panelCtrl = this.panelController();
    if (!panelCtrl) return;
    panelCtrl.setHighlight(false);
    this.commitPlacement(panelCtrl.spherical);
    this.syncHandleVisibility();
  }

  private commitPlacement(desired: { yawDeg: number; pitchDeg: number; radiusM: number }): void {
    const panelCtrl = this.panelController();
    if (!panelCtrl) return;

    const others = this.collectOtherPanelLayouts(panelCtrl.panelId);
    const resolved = resolvePanelPlacement(
      desired,
      others,
      panelCtrl.panelId,
      this.data.width,
      this.data.height,
    );
    panelCtrl.setSpherical(resolved);

    const detail: PanelLayout = {
      panelId: panelCtrl.panelId,
      yawDeg: resolved.yawDeg,
      pitchDeg: resolved.pitchDeg,
      radiusM: resolved.radiusM,
    };
    this.el.sceneEl.emit(PANEL_DROP_EVENT, detail);
  }

  private collectOtherPanelLayouts(selfPanelId: string): PanelLayout[] {
    const panelEls = this.el.sceneEl.querySelectorAll<Entity>('[imx-panel]');
    const layouts: PanelLayout[] = [];
    panelEls.forEach((panelEl) => {
      const comp = panelEl.components['imx-panel'] as PanelComponent | undefined;
      const ctrl = comp?.controller;
      if (!ctrl || ctrl.panelId === selfPanelId) return;
      layouts.push({
        panelId: ctrl.panelId,
        yawDeg: ctrl.spherical.yawDeg,
        pitchDeg: ctrl.spherical.pitchDeg,
        radiusM: ctrl.spherical.radiusM,
      });
    });
    return layouts;
  }
}

AFRAME.registerComponent<DragHandleComponent>('imx-drag-handle', {
  schema: {
    cameraSelector: { type: 'string', default: '#main-camera' },
    hoverRevealMs: { type: 'number', default: HANDLE_HOVER_REVEAL_MS },
    width: { type: 'number', default: PANEL_DEFAULT_WIDTH_M },
    height: { type: 'number', default: PANEL_DEFAULT_HEIGHT_M },
  },
  init() {
    this.controller = new DragHandleController(this.el, this.data);
  },
  tick(_time, delta) {
    this.controller?.tick(delta);
  },
  remove() {
    this.controller?.dispose();
  },
});
