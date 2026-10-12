import AFRAME, { type Component, type Entity } from 'aframe';
import 'aframe-troika-text';

import {
  DEFAULT_PANEL_RADIUS_M,
  PANEL_CORNER_RADIUS_M,
  PANEL_DEFAULT_HEIGHT_M,
  PANEL_DEFAULT_WIDTH_M,
  type PanelRadiusM,
  type ZoneTheme,
} from '../config/constants';
import '../systems/rounded-shape';
import {
  clampSpherical,
  panelFacingPitchDeg,
  panelFacingYawDeg,
  sphericalToCartesian,
  type SphericalCoords,
} from '../systems/spherical';
import {
  getThemePalette,
  resolveInitialTheme,
  ZONE_THEME_CHANGE_EVENT,
  ZONE_THEME_STORAGE_KEY,
} from '../systems/theme-controller';

export interface PanelData {
  panelId: string;
  title: string;
  body: string;
  footer: string;
  width: number;
  height: number;
  yawDeg: number;
  pitchDeg: number;
  radiusM: number;
}

export interface PanelComponent extends Component<PanelData> {
  controller?: PanelController;
}

function createSubEntity(tag: string, attributes: Record<string, unknown>): Entity {
  const el = document.createElement(tag) as Entity;
  for (const [key, value] of Object.entries(attributes)) {
    el.setAttribute(key, value);
  }
  return el;
}

function createTroikaTextEntity(attributes: {
  position?: string;
  align?: string;
  anchor?: string;
  baseline?: string;
  color?: string;
  fontSize?: number;
  maxWidth?: number;
  lineHeight?: number;
  clipRect?: string;
  value?: string;
}): Entity {
  const el = document.createElement('a-troika-text') as Entity;
  if (attributes.position) el.setAttribute('position', attributes.position);
  if (attributes.align) el.setAttribute('align', attributes.align);
  if (attributes.anchor) el.setAttribute('anchor', attributes.anchor);
  if (attributes.baseline) el.setAttribute('baseline', attributes.baseline);
  if (attributes.color) el.setAttribute('color', attributes.color);
  if (attributes.value !== undefined) el.setAttribute('value', attributes.value);
  if (attributes.fontSize !== undefined) {
    el.setAttribute('font-size', String(attributes.fontSize));
    el.setAttribute('fontSize', String(attributes.fontSize));
  }
  if (attributes.maxWidth !== undefined) {
    el.setAttribute('max-width', String(attributes.maxWidth));
    el.setAttribute('maxWidth', String(attributes.maxWidth));
  }
  if (attributes.lineHeight !== undefined) {
    el.setAttribute('line-height', String(attributes.lineHeight));
    el.setAttribute('lineHeight', String(attributes.lineHeight));
  }
  if (attributes.clipRect) {
    el.setAttribute('clip-rect', attributes.clipRect);
  }
  const config = [
    `value: ${attributes.value ?? ''}`,
    `color: ${attributes.color ?? '#0F172A'}`,
    `fontSize: ${attributes.fontSize ?? 0.02}`,
    `maxWidth: ${attributes.maxWidth ?? 0.6}`,
    `lineHeight: ${attributes.lineHeight ?? 1.35}`,
    `align: ${attributes.align ?? 'left'}`,
    `anchor: ${attributes.anchor ?? 'center'}`,
    `baseline: ${attributes.baseline ?? 'center'}`,
  ];
  if (attributes.clipRect) config.push(`clipRect: ${attributes.clipRect}`);
  el.setAttribute('troika-text', config.join('; '));
  return el;
}

// painel espacial com estética glassmorphism, cantos arredondados e borda branca de destaque
export class PanelController {
  private readonly borderEl: Entity;
  private readonly surfaceEl: Entity;
  private readonly headerLineEl: Entity;
  private readonly titleEl: Entity;
  private readonly bodyEl: Entity;
  private readonly footerEl: Entity;
  private coords: SphericalCoords;
  private currentTheme: ZoneTheme;
  private isHighlighted = false;

  private readonly onThemeChange = (event: Event): void => {
    const detail = (event as CustomEvent<{ theme: ZoneTheme }>).detail;
    if (detail?.theme) {
      this.applyTheme(detail.theme);
    }
  };

  constructor(
    private readonly el: Entity,
    private data: PanelData,
  ) {
    this.coords = clampSpherical({
      yawDeg: data.yawDeg,
      pitchDeg: data.pitchDeg,
      radiusM: data.radiusM,
    });
    this.el.classList.add('imx-panel-root');

    let storedPref: string | null = null;
    try {
      storedPref = localStorage.getItem(ZONE_THEME_STORAGE_KEY);
    } catch {
      // ignora caso localStorage não esteja acessível
    }
    this.currentTheme = resolveInitialTheme(storedPref);
    const palette = getThemePalette(this.currentTheme);
    const stroke = palette.panelBorderNormalStroke;

    this.borderEl = createSubEntity('a-entity', {
      geometry: `primitive: rounded-rect; width: ${data.width + 2 * stroke}; height: ${data.height + 2 * stroke}; radius: ${PANEL_CORNER_RADIUS_M + stroke}`,
      position: '0 0 -0.002',
      material: `color: ${palette.panelBorderColor}; shader: flat; opacity: ${palette.panelBorderNormalOpacity}; transparent: true`,
    });

    this.surfaceEl = createSubEntity('a-entity', {
      class: 'interactable',
      'data-no-dwell': 'true',
      geometry: `primitive: rounded-rect; width: ${data.width}; height: ${data.height}; radius: ${PANEL_CORNER_RADIUS_M}`,
      position: '0 0 0',
      material: `color: ${palette.panelBgColor}; shader: flat; opacity: ${palette.panelBgOpacity}; transparent: true`,
    });

    this.headerLineEl = createSubEntity('a-plane', {
      width: data.width - 0.08,
      height: 0.002,
      position: `0 ${data.height / 2 - 0.095} 0.002`,
      material: `color: ${palette.panelHeaderLineColor}; shader: flat; opacity: 0.65; transparent: true`,
    });

    const bodyHalfW = (data.width - 0.08) / 2;
    this.titleEl = createTroikaTextEntity({
      position: `0 ${data.height / 2 - 0.052} 0.004`,
      align: 'center',
      anchor: 'center',
      baseline: 'center',
      color: palette.textTitleColor,
      fontSize: 0.024,
      maxWidth: data.width - 0.08,
      value: data.title,
    });

    this.bodyEl = createTroikaTextEntity({
      position: `0 0.012 0.004`,
      align: 'left',
      anchor: 'center',
      baseline: 'center',
      color: palette.textBodyColor,
      fontSize: 0.021,
      lineHeight: 1.35,
      maxWidth: data.width - 0.08,
      clipRect: `${-bodyHalfW} -0.165 ${bodyHalfW} 0.165`,
      value: data.body,
    });

    this.footerEl = createTroikaTextEntity({
      position: `0 ${-data.height / 2 + 0.038} 0.004`,
      align: 'right',
      anchor: 'center',
      baseline: 'center',
      color: palette.textFooterColor,
      fontSize: 0.016,
      maxWidth: data.width - 0.08,
      value: data.footer,
    });

    this.el.appendChild(this.borderEl);
    this.el.appendChild(this.surfaceEl);
    this.el.appendChild(this.headerLineEl);
    this.el.appendChild(this.titleEl);
    this.el.appendChild(this.bodyEl);
    this.el.appendChild(this.footerEl);

    this.applyTransform();

    window.addEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
  }

  get spherical(): SphericalCoords {
    return this.coords;
  }

  get panelId(): string {
    return this.data.panelId || this.el.id;
  }

  get theme(): ZoneTheme {
    return this.currentTheme;
  }

  update(data: PanelData): void {
    this.data = data;
    this.coords = clampSpherical({
      yawDeg: data.yawDeg,
      pitchDeg: data.pitchDeg,
      radiusM: data.radiusM,
    });
    const palette = getThemePalette(this.currentTheme);
    const stroke = this.isHighlighted
      ? palette.panelBorderActiveStroke
      : palette.panelBorderNormalStroke;

    this.borderEl.setAttribute('geometry', {
      primitive: 'rounded-rect',
      width: data.width + 2 * stroke,
      height: data.height + 2 * stroke,
      radius: PANEL_CORNER_RADIUS_M + stroke,
    });
    this.surfaceEl.setAttribute('geometry', {
      primitive: 'rounded-rect',
      width: data.width,
      height: data.height,
      radius: PANEL_CORNER_RADIUS_M,
    });
    this.headerLineEl.setAttribute('width', data.width - 0.08);
    this.headerLineEl.setAttribute('position', `0 ${data.height / 2 - 0.095} 0.002`);
    this.titleEl.setAttribute('position', `0 ${data.height / 2 - 0.052} 0.004`);
    this.titleEl.setAttribute('max-width', String(data.width - 0.08));
    this.titleEl.setAttribute('value', data.title);
    this.titleEl.setAttribute('troika-text', 'value', data.title);
    this.bodyEl.setAttribute('max-width', String(data.width - 0.08));
    this.bodyEl.setAttribute('value', data.body);
    this.bodyEl.setAttribute('troika-text', 'value', data.body);
    this.footerEl.setAttribute('position', `0 ${-data.height / 2 + 0.038} 0.004`);
    this.footerEl.setAttribute('max-width', String(data.width - 0.08));
    this.footerEl.setAttribute('value', data.footer);
    this.footerEl.setAttribute('troika-text', 'value', data.footer);
    this.applyTransform();
  }

  setSpherical(coords: { yawDeg: number; pitchDeg: number; radiusM: PanelRadiusM }): void {
    this.coords = clampSpherical(coords);
    this.data.yawDeg = this.coords.yawDeg;
    this.data.pitchDeg = this.coords.pitchDeg;
    this.data.radiusM = this.coords.radiusM;
    this.applyTransform();
  }

  // espessa a borda branca (14 mm) e eleva a opacidade para 100% ao clicar ou arrastar
  setHighlight(active: boolean): void {
    this.isHighlighted = active;
    const palette = getThemePalette(this.currentTheme);
    const stroke = active ? palette.panelBorderActiveStroke : palette.panelBorderNormalStroke;
    const opacity = active ? palette.panelBorderActiveOpacity : palette.panelBorderNormalOpacity;

    this.borderEl.setAttribute('geometry', {
      primitive: 'rounded-rect',
      width: this.data.width + 2 * stroke,
      height: this.data.height + 2 * stroke,
      radius: PANEL_CORNER_RADIUS_M + stroke,
    });
    this.borderEl.setAttribute(
      'material',
      `color: ${palette.panelBorderColor}; shader: flat; opacity: ${opacity}; transparent: true`,
    );
  }

  // aplica a paleta do tema nos componentes visuais do painel
  applyTheme(theme: ZoneTheme): void {
    this.currentTheme = theme;
    const palette = getThemePalette(theme);

    this.surfaceEl.setAttribute(
      'material',
      `color: ${palette.panelBgColor}; shader: flat; opacity: ${palette.panelBgOpacity}; transparent: true`,
    );
    this.headerLineEl.setAttribute(
      'material',
      `color: ${palette.panelHeaderLineColor}; shader: flat; opacity: 0.65; transparent: true`,
    );
    this.titleEl.setAttribute('color', palette.textTitleColor);
    this.titleEl.setAttribute('troika-text', 'color', palette.textTitleColor);
    this.bodyEl.setAttribute('color', palette.textBodyColor);
    this.bodyEl.setAttribute('troika-text', 'color', palette.textBodyColor);
    this.footerEl.setAttribute('color', palette.textFooterColor);
    this.footerEl.setAttribute('troika-text', 'color', palette.textFooterColor);

    this.setHighlight(this.isHighlighted);
  }

  dispose(): void {
    window.removeEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
    this.borderEl.remove();
    this.surfaceEl.remove();
    this.headerLineEl.remove();
    this.titleEl.remove();
    this.bodyEl.remove();
    this.footerEl.remove();
  }

  private applyTransform(): void {
    const pos = sphericalToCartesian(this.coords);
    const rotX = panelFacingPitchDeg(this.coords.pitchDeg);
    const rotY = panelFacingYawDeg(this.coords.yawDeg);
    this.el.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);
    this.el.setAttribute('rotation', `${rotX} ${rotY} 0`);
  }
}

AFRAME.registerComponent<PanelComponent>('imx-panel', {
  schema: {
    panelId: { type: 'string', default: '' },
    title: { type: 'string', default: '' },
    body: { type: 'string', default: '' },
    footer: { type: 'string', default: '' },
    width: { type: 'number', default: PANEL_DEFAULT_WIDTH_M },
    height: { type: 'number', default: PANEL_DEFAULT_HEIGHT_M },
    yawDeg: { type: 'number', default: 0 },
    pitchDeg: { type: 'number', default: 0 },
    radiusM: { type: 'number', default: DEFAULT_PANEL_RADIUS_M },
  },
  init() {
    this.controller = new PanelController(this.el, this.data);
  },
  update() {
    this.controller?.update(this.data);
  },
  remove() {
    this.controller?.dispose();
  },
});
