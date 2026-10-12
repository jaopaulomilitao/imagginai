import AFRAME, { type Component, type Entity } from 'aframe';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import type { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

import { PT_BR } from '../../shared/i18n/pt-br';
import { logger } from '../../shared/logger';
import { PANEL_DEFAULT_HEIGHT_M, PANEL_DEFAULT_WIDTH_M, type ZoneTheme } from '../config/constants';
import type { SyntheticPdfPageContent } from '../systems/initial-panels';
import { clampPdfPage, computePdfPageWindow } from '../systems/pdf-page-window';
import '../systems/rounded-shape';
import {
  getThemePalette,
  resolveInitialTheme,
  ZONE_THEME_CHANGE_EVENT,
  ZONE_THEME_STORAGE_KEY,
} from '../systems/theme-controller';

export interface PdfPanelData {
  pdfUrl: string;
  sourceTitle: string;
  page: number;
  pageCount: number;
  width: number;
  height: number;
}

export interface PdfPanelComponent extends Component<PdfPanelData> {
  controller?: PdfPanelController;
}

export type SyntheticPageProvider = (pageNumber: number) => SyntheticPdfPageContent;

const CANVAS_WIDTH_PX = 1024;
const CANVAS_HEIGHT_PX = 768;

function createSubEntity(tag: string, attributes: Record<string, unknown>): Entity {
  const el = document.createElement(tag) as Entity;
  for (const [key, value] of Object.entries(attributes)) {
    el.setAttribute(key, value);
  }
  return el;
}

function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawSyntheticPageToCanvas(
  canvas: HTMLCanvasElement,
  content: SyntheticPdfPageContent,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, canvas.width, 82);

  ctx.fillStyle = '#E2E8F0';
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText(content.sourceTitle, 36, 52);

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.fillText(content.heading, 36, 144);

  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(36, 166);
  ctx.lineTo(canvas.width - 36, 166);
  ctx.stroke();

  ctx.fillStyle = '#1E293B';
  ctx.font = '29px system-ui, sans-serif';
  let y = 216;
  const maxWidth = canvas.width - 72;

  for (const paragraph of content.paragraphs) {
    const lines = wrapTextLines(ctx, paragraph, maxWidth);
    for (const line of lines) {
      if (y > canvas.height - 68) break;
      ctx.fillText(line, 36, y);
      y += 40;
    }
    y += 18;
    if (y > canvas.height - 68) break;
  }

  ctx.fillStyle = '#64748B';
  ctx.font = '22px system-ui, sans-serif';
  ctx.fillText(
    PT_BR.zone.panels.pdfPageIndicator(content.pageNumber, content.pageCount),
    canvas.width - 175,
    canvas.height - 26,
  );
}

interface NavButtonRefs {
  readonly containerEl: Entity;
  readonly borderEl: Entity;
  readonly btnEl: Entity;
  readonly textEl: Entity;
}

// painel de pdf que renderiza com pdf.js em CanvasTexture mantendo em memória apenas a página atual +- 1 (seção 2.2)
export class PdfPanelController {
  private readonly pageCache = new Map<number, CanvasTexture>();
  private readonly canvasMesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly prevNav: NavButtonRefs;
  private readonly nextNav: NavButtonRefs;
  private readonly pageLabelEl: Entity;
  private pdfDoc: PDFDocumentProxy | null = null;
  private loadedUrl = '';
  private currentPage: number;
  private totalPages: number;
  private syntheticProvider: SyntheticPageProvider | null = null;
  private currentTheme: ZoneTheme;

  private readonly onThemeChange = (event: Event): void => {
    const detail = (event as CustomEvent<{ theme: ZoneTheme }>).detail;
    if (detail?.theme) {
      this.applyTheme(detail.theme);
    }
  };

  private readonly onPrevClick = (): void => {
    this.goToPage(this.currentPage - 1);
  };

  private readonly onNextClick = (): void => {
    this.goToPage(this.currentPage + 1);
  };

  constructor(
    private readonly el: Entity,
    private data: PdfPanelData,
  ) {
    this.totalPages = Math.max(1, data.pageCount);
    this.currentPage = clampPdfPage(data.page, this.totalPages);

    let storedPref: string | null = null;
    try {
      storedPref = localStorage.getItem(ZONE_THEME_STORAGE_KEY);
    } catch {
      // ignora caso localStorage não esteja acessível
    }
    this.currentTheme = resolveInitialTheme(storedPref);
    const palette = getThemePalette(this.currentTheme);

    this.el.setAttribute('imx-panel', {
      panelId: this.el.id || 'panel-pdf',
      title: data.sourceTitle,
      body: '',
      footer: '',
      width: data.width,
      height: data.height,
    });

    const THREE = AFRAME.THREE;
    const planeW = data.width - 0.06;
    const planeH = data.height - 0.22;
    const geometry = new THREE.PlaneGeometry(planeW, planeH);
    // define transparent: true e renderOrder > 0 para desenhar na fila transparente após o passthrough (renderOrder -1)
    const material = new THREE.MeshBasicMaterial({
      color: '#FFFFFF',
      side: THREE.FrontSide,
      transparent: true,
      opacity: 1.0,
    });
    this.canvasMesh = new THREE.Mesh(geometry, material);
    this.canvasMesh.renderOrder = 2;
    this.canvasMesh.position.set(0, 0.008, 0.005);
    this.el.object3D.add(this.canvasMesh);

    const footerY = -data.height / 2 + 0.055;
    this.prevNav = this.createNavButton(
      PT_BR.zone.panels.pdfPrevPage,
      -data.width / 2 + 0.11,
      footerY,
    );
    this.nextNav = this.createNavButton(
      PT_BR.zone.panels.pdfNextPage,
      data.width / 2 - 0.11,
      footerY,
    );
    const indicatorText = PT_BR.zone.panels.pdfPageIndicator(this.currentPage, this.totalPages);
    this.pageLabelEl = createSubEntity('a-troika-text', {
      position: `0 ${footerY} 0.015`,
      align: 'center',
      anchor: 'center',
      baseline: 'center',
      color: palette.textFooterColor,
      'font-size': 0.016,
      fontSize: 0.016,
      value: indicatorText,
      'troika-text': `value: ${indicatorText}; fontSize: 0.016; color: ${palette.textFooterColor}; align: center; anchor: center; baseline: center`,
    });

    this.prevNav.btnEl.addEventListener('click', this.onPrevClick);
    this.nextNav.btnEl.addEventListener('click', this.onNextClick);
    this.el.appendChild(this.prevNav.containerEl);
    this.el.appendChild(this.nextNav.containerEl);
    this.el.appendChild(this.pageLabelEl);

    window.addEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);

    void this.syncDocumentAndWindow();
  }

  get cachedPageNumbers(): number[] {
    return [...this.pageCache.keys()].sort((a, b) => a - b);
  }

  get page(): number {
    return this.currentPage;
  }

  setSyntheticPageProvider(provider: SyntheticPageProvider): void {
    this.syntheticProvider = provider;
    this.evictAllTextures();
    void this.refreshWindow();
  }

  update(data: PdfPanelData): void {
    const urlChanged = data.pdfUrl !== this.loadedUrl;
    this.data = data;
    this.totalPages = Math.max(1, data.pageCount);
    this.currentPage = clampPdfPage(data.page, this.totalPages);
    this.el.setAttribute('imx-panel', 'title', data.sourceTitle);
    if (urlChanged) {
      void this.syncDocumentAndWindow();
    } else {
      void this.refreshWindow();
    }
  }

  goToPage(targetPage: number): void {
    const clamped = clampPdfPage(targetPage, this.totalPages);
    if (clamped === this.currentPage) return;
    this.currentPage = clamped;
    this.data.page = clamped;
    void this.refreshWindow();
  }

  applyTheme(theme: ZoneTheme): void {
    this.currentTheme = theme;
    const palette = getThemePalette(theme);

    this.prevNav.borderEl.setAttribute(
      'material',
      `color: ${palette.buttonBorderColor}; shader: flat; opacity: 0.85; transparent: true`,
    );
    this.prevNav.btnEl.setAttribute(
      'material',
      `color: ${palette.buttonBgColor}; shader: flat; opacity: ${palette.buttonBgOpacity}; transparent: true`,
    );
    this.prevNav.textEl.setAttribute('color', palette.buttonTextColor);
    this.prevNav.textEl.setAttribute('troika-text', 'color', palette.buttonTextColor);

    this.nextNav.borderEl.setAttribute(
      'material',
      `color: ${palette.buttonBorderColor}; shader: flat; opacity: 0.85; transparent: true`,
    );
    this.nextNav.btnEl.setAttribute(
      'material',
      `color: ${palette.buttonBgColor}; shader: flat; opacity: ${palette.buttonBgOpacity}; transparent: true`,
    );
    this.nextNav.textEl.setAttribute('color', palette.buttonTextColor);
    this.nextNav.textEl.setAttribute('troika-text', 'color', palette.buttonTextColor);

    this.pageLabelEl.setAttribute('color', palette.textFooterColor);
    this.pageLabelEl.setAttribute('troika-text', 'color', palette.textFooterColor);
  }

  dispose(): void {
    window.removeEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
    this.prevNav.btnEl.removeEventListener('click', this.onPrevClick);
    this.nextNav.btnEl.removeEventListener('click', this.onNextClick);
    this.prevNav.containerEl.remove();
    this.nextNav.containerEl.remove();
    this.pageLabelEl.remove();
    this.canvasMesh.removeFromParent();
    this.canvasMesh.geometry.dispose();
    this.canvasMesh.material.dispose();
    this.evictAllTextures();
    if (this.pdfDoc) {
      void this.pdfDoc.cleanup();
      this.pdfDoc = null;
    }
  }

  private createNavButton(label: string, x: number, y: number): NavButtonRefs {
    const containerEl = createSubEntity('a-entity', {
      position: `${x} ${y} 0.015`,
    });
    const palette = getThemePalette(this.currentTheme);
    const stroke = 0.004;

    const borderEl = createSubEntity('a-entity', {
      geometry: `primitive: rounded-rect; width: ${0.16 + 2 * stroke}; height: ${0.07 + 2 * stroke}; radius: ${0.014 + stroke}`,
      position: '0 0 -0.001',
      material: `color: ${palette.buttonBorderColor}; shader: flat; opacity: 0.85; transparent: true`,
    });
    const btnEl = createSubEntity('a-entity', {
      class: 'interactable',
      geometry: 'primitive: rounded-rect; width: 0.16; height: 0.07; radius: 0.014',
      position: '0 0 0',
      material: `color: ${palette.buttonBgColor}; shader: flat; opacity: ${palette.buttonBgOpacity}; transparent: true`,
    });
    const textEl = createSubEntity('a-troika-text', {
      position: '0 0 0.003',
      align: 'center',
      anchor: 'center',
      baseline: 'center',
      color: palette.buttonTextColor,
      'font-size': 0.018,
      fontSize: 0.018,
      value: label,
      'troika-text': `value: ${label}; fontSize: 0.018; color: ${palette.buttonTextColor}; align: center; anchor: center; baseline: center`,
    });
    btnEl.appendChild(textEl);
    containerEl.appendChild(borderEl);
    containerEl.appendChild(btnEl);

    return { containerEl, borderEl, btnEl, textEl };
  }

  private async syncDocumentAndWindow(): Promise<void> {
    this.evictAllTextures();
    if (this.pdfDoc) {
      await this.pdfDoc.cleanup();
      this.pdfDoc = null;
    }
    this.loadedUrl = this.data.pdfUrl;
    if (this.data.pdfUrl) {
      try {
        const loadingTask = getDocument({ url: this.data.pdfUrl });
        this.pdfDoc = await loadingTask.promise;
        this.totalPages = Math.max(1, this.pdfDoc.numPages);
        this.currentPage = clampPdfPage(this.currentPage, this.totalPages);
      } catch (error) {
        logger.warn('pdf.js load failed, falling back to offline synthetic page canvas', error);
        this.pdfDoc = null;
      }
    }
    await this.refreshWindow();
  }

  private async refreshWindow(): Promise<void> {
    const plan = computePdfPageWindow(this.currentPage, this.totalPages, [
      ...this.pageCache.keys(),
    ]);
    for (const pageToEvict of plan.pagesToEvict) {
      const tex = this.pageCache.get(pageToEvict);
      tex?.dispose();
      this.pageCache.delete(pageToEvict);
    }

    for (const pageToRender of plan.pagesToRender) {
      const texture = await this.renderPageTexture(pageToRender);
      this.pageCache.set(pageToRender, texture);
    }

    const activeTexture = this.pageCache.get(this.currentPage) ?? null;
    if (activeTexture) {
      this.canvasMesh.material.map = activeTexture;
      this.canvasMesh.material.needsUpdate = true;
    }

    const indicator = PT_BR.zone.panels.pdfPageIndicator(this.currentPage, this.totalPages);
    this.pageLabelEl.setAttribute('value', indicator);
    this.pageLabelEl.setAttribute('troika-text', 'value', indicator);
  }

  private async renderPageTexture(pageNumber: number): Promise<CanvasTexture> {
    const THREE = AFRAME.THREE;
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH_PX;
    canvas.height = CANVAS_HEIGHT_PX;

    if (this.pdfDoc) {
      const page = await this.pdfDoc.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(
        CANVAS_WIDTH_PX / baseViewport.width,
        CANVAS_HEIGHT_PX / baseViewport.height,
      );
      const viewport = page.getViewport({ scale });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
    } else {
      const content = this.syntheticProvider
        ? this.syntheticProvider(pageNumber)
        : {
            pageNumber,
            pageCount: this.totalPages,
            sourceTitle: this.data.sourceTitle,
            heading: `Página ${pageNumber}`,
            paragraphs: [this.data.sourceTitle],
          };
      drawSyntheticPageToCanvas(canvas, content);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  private evictAllTextures(): void {
    for (const tex of this.pageCache.values()) {
      tex.dispose();
    }
    this.pageCache.clear();
  }
}

AFRAME.registerComponent<PdfPanelComponent>('imx-pdf-panel', {
  dependencies: ['imx-panel'],
  schema: {
    pdfUrl: { type: 'string', default: '' },
    sourceTitle: { type: 'string', default: 'Documento PDF' },
    page: { type: 'int', default: 1 },
    pageCount: { type: 'int', default: 4 },
    width: { type: 'number', default: PANEL_DEFAULT_WIDTH_M },
    height: { type: 'number', default: PANEL_DEFAULT_HEIGHT_M },
  },
  init() {
    this.controller = new PdfPanelController(this.el, this.data);
  },
  update() {
    this.controller?.update(this.data);
  },
  remove() {
    this.controller?.dispose();
  },
});
