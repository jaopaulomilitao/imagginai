import AFRAME, { type Component, type Entity } from 'aframe';
import type { CursorComponent, CursorHoverDetail } from 'interacxr';

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
import {
  createPhosphorIconEntity,
  updatePhosphorIconAppearance,
} from '../systems/phosphor-icon-canvas';
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
export const PANEL_DELETE_EVENT = 'imx-panel-delete';

export interface PanelDeleteDetail {
  readonly panelId: string;
  readonly contentId: string;
}

interface DragHandleData {
  cameraSelector: string;
  hoverRevealMs: number;
  width: number;
  height: number;
  contentId: string;
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

// alça superior de controle com botões phosphor (- / +), alça de 6 pontos e botão de exclusão (trash)
export class DragHandleController {
  readonly state: DragHandleStateMachine;
  private readonly barRootEl: Entity;
  private readonly handleBorderEl: Entity;
  private readonly handleEl: Entity;
  private readonly dotEls: Entity[] = [];
  private readonly minusBorderEl: Entity;
  private readonly minusBtnEl: Entity;
  private readonly minusIconEl: Entity;
  private readonly plusBorderEl: Entity;
  private readonly plusBtnEl: Entity;
  private readonly plusIconEl: Entity;
  private readonly trashBorderEl: Entity;
  private readonly trashBtnEl: Entity;
  private readonly trashIconEl: Entity;
  private readonly cameraDirection = new AFRAME.THREE.Vector3();
  private lastVisibleState: boolean | null = null;
  private lastBarScale = -1;
  private lastPanelHeight = -1;
  private currentTheme: ZoneTheme;
  private isDeleting = false;

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
    const panelCtrl = this.panelController();
    const isBorder = panelCtrl?.isBorderElement(hovered);
    const isHandle =
      hovered === this.handleEl || (hovered !== null && this.handleEl.contains(hovered));
    if ((isHandle || isBorder) && this.state.startGrabDrag()) {
      panelCtrl?.setHighlight(true);
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

  private readonly onPinchStart = (): void => {
    const hovered = this.currentHoveredElement();
    const panelCtrl = this.panelController();
    const isBorder = panelCtrl?.isBorderElement(hovered);
    const isHandle =
      hovered === this.handleEl || (hovered !== null && this.handleEl.contains(hovered));
    if ((isHandle || isBorder) && this.state.startPinchDrag()) {
      panelCtrl?.setHighlight(true);
      this.setHandleHighlight(true);
      this.syncHandleVisibility();
    }
  };

  private readonly onPinchEnd = (): void => {
    if (this.state.endPinchDrag()) {
      this.setHandleHighlight(false);
      this.finishDrop();
    }
  };

  private readonly onHandleMouseDown = (event: Event): void => {
    event.stopPropagation();
    const panelCtrl = this.panelController();
    if (this.state.startPinchDrag()) {
      panelCtrl?.setHighlight(true);
      this.setHandleHighlight(true);
      this.syncHandleVisibility();
    }
  };

  private readonly onWindowMouseUp = (): void => {
    if (this.state.mode === 'pinch' && this.state.endPinchDrag()) {
      this.setHandleHighlight(false);
      this.finishDrop();
    }
  };

  // botão '-' redimensiona para menor o grafo 3d ou afasta o painel (seção 3)
  private readonly onMinusClick = (event?: Event): void => {
    event?.stopPropagation();
    const conceptGraph = this.el.components['imx-concept-graph'] as
      { controller?: { adjustScale(direction: 1 | -1): void } } | undefined;
    if (conceptGraph?.controller) {
      conceptGraph.controller.adjustScale(-1);
      this.syncHandleBarScale();
      return;
    }
    this.changeRadius(1);
  };

  // botão '+' redimensiona para maior o grafo 3d ou aproxima o painel (seção 3)
  private readonly onPlusClick = (event?: Event): void => {
    event?.stopPropagation();
    const conceptGraph = this.el.components['imx-concept-graph'] as
      { controller?: { adjustScale(direction: 1 | -1): void } } | undefined;
    if (conceptGraph?.controller) {
      conceptGraph.controller.adjustScale(1);
      this.syncHandleBarScale();
      return;
    }
    this.changeRadius(-1);
  };

  // botão de lixeira (trash) remove o painel da cena com transição fade-out e libera o item no menu conteúdos (seção 4.4)
  private readonly onTrashClick = (event?: Event): void => {
    event?.stopPropagation();
    if (this.isDeleting) return;
    this.isDeleting = true;
    const panelCtrl = this.panelController();
    const panelId = panelCtrl?.panelId ?? this.el.id;
    const contentId = this.data.contentId || panelId;
    const detail: PanelDeleteDetail = { panelId, contentId };

    if (panelCtrl) {
      panelCtrl.fadeOutAndRemove(240, () => {
        this.el.sceneEl?.emit(PANEL_DELETE_EVENT, detail);
      });
    } else {
      this.el.remove();
      this.el.sceneEl?.emit(PANEL_DELETE_EVENT, detail);
    }
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

    const isGraph = this.el.hasAttribute('imx-concept-graph');
    const topY = data.height / 2 + PANEL_HANDLE_HEIGHT_M / 2 + (isGraph ? 0.038 : 0.02);
    const zPos = isGraph ? 0.08 : 0.024;
    this.barRootEl = createSubEntity('a-entity', {
      position: `0 ${topY} ${zPos}`,
      visible: false,
      'data-ixr-ignore-rotate': 'true',
    });

    // ponte invisível de colisão estritamente abaixo dos botões na travessia entre o topo do painel e a alça
    const bridgeEl = createSubEntity('a-plane', {
      class: 'interactable',
      'data-hit-volume': 'true',
      width: 0.44,
      height: 0.034,
      position: '0 -0.052 -0.005',
      material:
        'shader: flat; color: #ffffff; opacity: 0.001; transparent: true; depthWrite: false',
    });
    this.barRootEl.appendChild(bridgeEl);

    const hBorderStroke = 0.004;
    this.handleBorderEl = createSubEntity('a-entity', {
      geometry: `primitive: rounded-rect; width: ${PANEL_HANDLE_WIDTH_M + 2 * hBorderStroke}; height: ${PANEL_HANDLE_HEIGHT_M + 2 * hBorderStroke}; radius: ${0.016 + hBorderStroke}`,
      position: '0 0 0.003',
      material: `color: ${palette.handleBorderColor}; shader: flat; opacity: 0.85; transparent: true`,
    });

    this.handleEl = createSubEntity('a-entity', {
      class: 'interactable',
      'data-action': 'move-handle',
      geometry: `primitive: rounded-rect; width: ${PANEL_HANDLE_WIDTH_M}; height: ${PANEL_HANDLE_HEIGHT_M}; radius: 0.016`,
      position: '0 0 0.005',
      material: `color: ${palette.handleBgColor}; shader: flat; opacity: ${palette.handleBgOpacity}; transparent: true`,
    });

    const cols = [-0.013, 0.013];
    const rows = [0.015, 0, -0.015];
    for (const x of cols) {
      for (const y of rows) {
        const dot = createSubEntity('a-circle', {
          radius: 0.0045,
          position: `${x} ${y} 0.008`,
          material: `color: ${palette.handleDotsColor}; shader: flat`,
        });
        this.dotEls.push(dot);
        this.handleEl.appendChild(dot);
      }
    }

    const sideOffset = PANEL_HANDLE_WIDTH_M / 2 + PANEL_BUTTON_SIZE_M / 2 + 0.018;
    const trashOffset = sideOffset + PANEL_BUTTON_SIZE_M + 0.018;
    const bStroke = 0.004;

    this.minusBorderEl = createSubEntity('a-entity', {
      geometry: `primitive: rounded-rect; width: ${PANEL_BUTTON_SIZE_M + 2 * bStroke}; height: ${PANEL_HANDLE_HEIGHT_M + 2 * bStroke}; radius: ${0.014 + bStroke}`,
      position: `${-sideOffset} 0 0.003`,
      material: `color: ${palette.buttonBorderColor}; shader: flat; opacity: 0.85; transparent: true`,
    });
    this.minusBtnEl = createSubEntity('a-entity', {
      class: 'interactable',
      'data-action': 'minus',
      geometry: `primitive: rounded-rect; width: ${PANEL_BUTTON_SIZE_M}; height: ${PANEL_HANDLE_HEIGHT_M}; radius: 0.014`,
      position: `${-sideOffset} 0 0.005`,
      material: `color: ${palette.buttonBgColor}; shader: flat; opacity: ${palette.buttonBgOpacity}; transparent: true`,
    });
    this.minusIconEl = createPhosphorIconEntity({
      icon: 'minus',
      color: palette.buttonTextColor,
      size: 0.032,
      position: '0 0 0.008',
    });
    this.minusBtnEl.appendChild(this.minusIconEl);

    this.plusBorderEl = createSubEntity('a-entity', {
      geometry: `primitive: rounded-rect; width: ${PANEL_BUTTON_SIZE_M + 2 * bStroke}; height: ${PANEL_HANDLE_HEIGHT_M + 2 * bStroke}; radius: ${0.014 + bStroke}`,
      position: `${sideOffset} 0 0.003`,
      material: `color: ${palette.buttonBorderColor}; shader: flat; opacity: 0.85; transparent: true`,
    });
    this.plusBtnEl = createSubEntity('a-entity', {
      class: 'interactable',
      'data-action': 'plus',
      geometry: `primitive: rounded-rect; width: ${PANEL_BUTTON_SIZE_M}; height: ${PANEL_HANDLE_HEIGHT_M}; radius: 0.014`,
      position: `${sideOffset} 0 0.005`,
      material: `color: ${palette.buttonBgColor}; shader: flat; opacity: ${palette.buttonBgOpacity}; transparent: true`,
    });
    this.plusIconEl = createPhosphorIconEntity({
      icon: 'plus',
      color: palette.buttonTextColor,
      size: 0.032,
      position: '0 0 0.008',
    });
    this.plusBtnEl.appendChild(this.plusIconEl);

    // botão de exclusão (trash phosphor icon) posicionado ao lado do controle +
    this.trashBorderEl = createSubEntity('a-entity', {
      geometry: `primitive: rounded-rect; width: ${PANEL_BUTTON_SIZE_M + 2 * bStroke}; height: ${PANEL_HANDLE_HEIGHT_M + 2 * bStroke}; radius: ${0.014 + bStroke}`,
      position: `${trashOffset} 0 0.003`,
      material: `color: #FB7185; shader: flat; opacity: 0.9; transparent: true`,
    });
    this.trashBtnEl = createSubEntity('a-entity', {
      class: 'interactable',
      'data-action': 'delete-panel',
      geometry: `primitive: rounded-rect; width: ${PANEL_BUTTON_SIZE_M}; height: ${PANEL_HANDLE_HEIGHT_M}; radius: 0.014`,
      position: `${trashOffset} 0 0.005`,
      material: `color: #18181B; shader: flat; opacity: 0.92; transparent: true`,
    });
    this.trashIconEl = createPhosphorIconEntity({
      icon: 'trash',
      color: '#FB7185',
      size: 0.034,
      position: '0 0 0.008',
    });
    this.trashBtnEl.appendChild(this.trashIconEl);

    this.barRootEl.appendChild(this.minusBorderEl);
    this.barRootEl.appendChild(this.minusBtnEl);
    this.barRootEl.appendChild(this.handleBorderEl);
    this.barRootEl.appendChild(this.handleEl);
    this.barRootEl.appendChild(this.plusBorderEl);
    this.barRootEl.appendChild(this.plusBtnEl);
    this.barRootEl.appendChild(this.trashBorderEl);
    this.barRootEl.appendChild(this.trashBtnEl);
    this.el.appendChild(this.barRootEl);

    const setupButtonHover = (btnEl: Entity) => {
      btnEl.addEventListener('mouseenter', () => {
        btnEl.setAttribute('scale', '1.08 1.08 1.08');
      });
      btnEl.addEventListener('mouseleave', () => {
        btnEl.setAttribute('scale', '1 1 1');
      });
    };
    setupButtonHover(this.minusBtnEl);
    setupButtonHover(this.plusBtnEl);
    setupButtonHover(this.trashBtnEl);
    setupButtonHover(this.handleEl);

    this.minusBtnEl.addEventListener('click', this.onMinusClick);
    this.minusIconEl.addEventListener('click', this.onMinusClick);
    this.plusBtnEl.addEventListener('click', this.onPlusClick);
    this.plusIconEl.addEventListener('click', this.onPlusClick);
    this.trashBtnEl.addEventListener('click', this.onTrashClick);
    this.trashIconEl.addEventListener('click', this.onTrashClick);
    this.handleEl.addEventListener('mousedown', this.onHandleMouseDown);

    const cameraEl = this.cameraEntity();
    cameraEl?.addEventListener('ixr-cursor-hover-start', this.onHoverStart);
    cameraEl?.addEventListener('ixr-cursor-hover-end', this.onHoverEnd);
    cameraEl?.addEventListener('ixr-grab-start', this.onGrabStart);
    cameraEl?.addEventListener('ixr-grab-end', this.onGrabEnd);
    cameraEl?.addEventListener('ixr-pinch-start', this.onPinchStart);
    cameraEl?.addEventListener('ixr-pinch-end', this.onPinchEnd);
    cameraEl?.addEventListener('ixr-hand-lost', this.onGrabEnd);
    cameraEl?.addEventListener('ixr-hand-lost', this.onPinchEnd);

    window.addEventListener('mouseup', this.onWindowMouseUp);
    window.addEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);

    this.syncHandleBarScale();
    this.syncHandleVisibility();
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
    window.removeEventListener('mouseup', this.onWindowMouseUp);
    window.removeEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
    const cameraEl = this.cameraEntity();
    cameraEl?.removeEventListener('ixr-cursor-hover-start', this.onHoverStart);
    cameraEl?.removeEventListener('ixr-cursor-hover-end', this.onHoverEnd);
    cameraEl?.removeEventListener('ixr-grab-start', this.onGrabStart);
    cameraEl?.removeEventListener('ixr-grab-end', this.onGrabEnd);
    cameraEl?.removeEventListener('ixr-pinch-start', this.onPinchStart);
    cameraEl?.removeEventListener('ixr-pinch-end', this.onPinchEnd);
    cameraEl?.removeEventListener('ixr-hand-lost', this.onGrabEnd);
    cameraEl?.removeEventListener('ixr-hand-lost', this.onPinchEnd);
    this.handleEl.removeEventListener('mousedown', this.onHandleMouseDown);
    this.minusBtnEl.removeEventListener('click', this.onMinusClick);
    this.plusBtnEl.removeEventListener('click', this.onPlusClick);
    this.trashBtnEl.removeEventListener('click', this.onTrashClick);
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
      `color: #F5F3EB; shader: flat; opacity: ${opacity}; transparent: true`,
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
    updatePhosphorIconAppearance(this.minusIconEl, palette.buttonTextColor);

    this.plusBtnEl.setAttribute(
      'material',
      `color: ${palette.buttonBgColor}; shader: flat; opacity: ${palette.buttonBgOpacity}; transparent: true`,
    );
    this.plusBorderEl.setAttribute(
      'material',
      `color: ${palette.buttonBorderColor}; shader: flat; opacity: 0.85; transparent: true`,
    );
    updatePhosphorIconAppearance(this.plusIconEl, palette.buttonTextColor);
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
    const panelCtrl = this.panelController();
    const isFramelessGraph =
      Boolean(panelCtrl?.isFrameless) || this.el.hasAttribute('imx-concept-graph');
    const visible = isFramelessGraph || this.state.isHandleVisible;
    if (visible === this.lastVisibleState) return;
    this.lastVisibleState = visible;
    this.barRootEl.setAttribute('visible', visible);
  }

  updateData(data: DragHandleData): void {
    this.data = data;
    this.syncHandleBarScale();
  }

  private syncHandleBarScale(): void {
    const panelCtrl = this.panelController();
    const radiusM = panelCtrl?.spherical.radiusM ?? 1.5;
    const scale = calcHandleBarScale(radiusM);
    const effectiveHeight = panelCtrl?.height ?? this.data.height;
    if (scale === this.lastBarScale && effectiveHeight === this.lastPanelHeight) return;
    this.lastBarScale = scale;
    this.lastPanelHeight = effectiveHeight;
    const isGraph = this.el.hasAttribute('imx-concept-graph');
    const topY =
      effectiveHeight / 2 + (PANEL_HANDLE_HEIGHT_M * scale) / 2 + (isGraph ? 0.048 : 0.02);
    const zPos = isGraph ? 0.09 : 0.024;
    this.barRootEl.setAttribute('position', `0 ${topY} ${zPos}`);
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
      panelCtrl.width || this.data.width,
      panelCtrl.height || this.data.height,
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
    contentId: { type: 'string', default: '' },
  },
  init() {
    this.controller = new DragHandleController(this.el, this.data);
  },
  update() {
    this.controller?.updateData(this.data);
  },
  tick(_time, delta) {
    this.controller?.tick(delta);
  },
  remove() {
    this.controller?.dispose();
  },
});
