import AFRAME, { type Component, type Entity } from 'aframe';
import * as pdfjsLib from 'pdfjs-dist';
import type { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
}

import { PT_BR } from '../../shared/i18n/pt-br';
import { logger } from '../../shared/logger';
import type { ZoneTheme } from '../config/constants';
import type { SyntheticPdfPageContent } from '../systems/initial-panels';
import { computePdfPageWindow } from '../systems/pdf-page-window';
import { clampPdfPage } from '../systems/pdf-page-window';
import {
  createPhosphorIconEntity,
  updatePhosphorIconAppearance,
  type PhosphorVrIconName,
} from '../systems/phosphor-icon-canvas';
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

const CANVAS_WIDTH_PX = 1440;
const CANVAS_HEIGHT_PX = 1920;

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

  ctx.fillStyle = '#F5F3EB';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#121316';
  ctx.fillRect(0, 0, canvas.width, 82);

  ctx.fillStyle = '#F5F3EB';
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText(content.sourceTitle, 36, 52);

  ctx.fillStyle = '#121316';
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.fillText(content.heading, 36, 144);

  ctx.strokeStyle = '#121316';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(36, 166);
  ctx.lineTo(canvas.width - 36, 166);
  ctx.stroke();

  ctx.fillStyle = '#18181B';
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

  ctx.fillStyle = '#52525B';
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
  readonly iconEl: Entity;
  readonly textEl: Entity;
}

// painel de pdf que renderiza com pdf.js em CanvasTexture mantendo em memória apenas a página atual +- 1
export class PdfPanelController {
  private readonly pageCache = new Map<number, CanvasTexture>();
  private readonly canvasMesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly prevNav: NavButtonRefs;
  private readonly nextNav: NavButtonRefs;
  private readonly pageLabelEl: Entity;
  private pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
  private pdfBytes: Uint8Array | null = null;
  private loadedUrl = '';
  private currentPage: number;
  private totalPages: number;
  private syntheticProvider: SyntheticPageProvider | null = null;
  private currentTheme: ZoneTheme;
  private syncVersion = 0;
  private isLoadingDoc = false;

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
      accentColor: '#1E3A8A',
    });

    const THREE = AFRAME.THREE;
    const planeW = data.width - 0.06;
    const planeH = data.height - 0.22;
    const geometry = new THREE.PlaneGeometry(planeW, planeH);
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
      'caret-left',
      -data.width / 2 + 0.11,
      footerY,
    );
    this.nextNav = this.createNavButton(
      PT_BR.zone.panels.pdfNextPage,
      'caret-right',
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

  setPdfBytes(bytes: Uint8Array | null): void {
    this.pdfBytes = bytes ? new Uint8Array(bytes) : null;
    this.syntheticProvider = null;
    this.evictAllTextures();
    void this.syncDocumentAndWindow();
  }

  setSyntheticPageProvider(provider: SyntheticPageProvider): void {
    this.syntheticProvider = provider;
    this.evictAllTextures();
    void this.refreshWindow();
  }

  update(data: PdfPanelData): void {
    const urlChanged = data.pdfUrl !== this.loadedUrl;
    this.data = data;
    this.totalPages = this.pdfDoc ? this.pdfDoc.numPages : Math.max(1, data.pageCount);
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
    updatePhosphorIconAppearance(this.prevNav.iconEl, palette.buttonTextColor);

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
    updatePhosphorIconAppearance(this.nextNav.iconEl, palette.buttonTextColor);

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

  private createNavButton(
    label: string,
    icon: PhosphorVrIconName,
    x: number,
    y: number,
  ): NavButtonRefs {
    const containerEl = createSubEntity('a-entity', {
      position: `${x} ${y} 0.015`,
    });
    const palette = getThemePalette(this.currentTheme);
    const stroke = 0.004;

    const borderEl = createSubEntity('a-entity', {
      geometry: `primitive: rounded-rect; width: ${0.17 + 2 * stroke}; height: ${0.068 + 2 * stroke}; radius: ${0.014 + stroke}`,
      position: '0 0 -0.001',
      material: `color: ${palette.buttonBorderColor}; shader: flat; opacity: 0.85; transparent: true`,
    });
    const btnEl = createSubEntity('a-entity', {
      class: 'interactable',
      geometry: 'primitive: rounded-rect; width: 0.17; height: 0.068; radius: 0.014',
      position: '0 0 0',
      material: `color: ${palette.buttonBgColor}; shader: flat; opacity: ${palette.buttonBgOpacity}; transparent: true`,
    });
    const isLeft = icon === 'caret-left';
    const iconEl = createPhosphorIconEntity({
      icon,
      color: palette.buttonTextColor,
      size: 0.022,
      position: `${isLeft ? -0.056 : 0.056} 0 0.004`,
    });
    const textEl = createSubEntity('a-troika-text', {
      position: `${isLeft ? 0.012 : -0.012} 0 0.003`,
      align: 'center',
      anchor: 'center',
      baseline: 'center',
      color: palette.buttonTextColor,
      'font-size': 0.016,
      fontSize: 0.016,
      value: label,
      'troika-text': `value: ${label}; fontSize: 0.016; color: ${palette.buttonTextColor}; align: center; anchor: center; baseline: center`,
    });
    btnEl.appendChild(iconEl);
    btnEl.appendChild(textEl);
    containerEl.appendChild(borderEl);
    containerEl.appendChild(btnEl);

    return { containerEl, borderEl, btnEl, iconEl, textEl };
  }

  private applyResponsiveAspectRatio(aspectRatio: number): void {
    const safeAspect = Number.isFinite(aspectRatio) && aspectRatio > 0.1 ? aspectRatio : 0.707;
    let planeW: number;
    let planeH: number;

    if (safeAspect >= 1.0) {
      // documento em modo paisagem (ex.: slides 16:9 ou 4:3)
      planeH = Math.min(0.54, 0.96 / safeAspect);
      planeW = Math.round(planeH * safeAspect * 1000) / 1000;
      planeH = Math.round(planeH * 1000) / 1000;
    } else {
      // documento em modo retrato (ex.: a4 ou carta)
      planeH = 0.72;
      planeW = Math.max(0.38, Math.round(planeH * safeAspect * 1000) / 1000);
    }

    const panelW = Math.max(0.56, Math.round((planeW + 0.06) * 1000) / 1000);
    const panelH = Math.round((planeH + 0.22) * 1000) / 1000;

    this.data.width = panelW;
    this.data.height = panelH;

    this.el.setAttribute('imx-panel', {
      width: panelW,
      height: panelH,
      title: this.data.sourceTitle,
    });
    this.el.setAttribute('imx-drag-handle', {
      width: panelW,
      height: panelH,
    });

    const THREE = AFRAME.THREE;
    this.canvasMesh.geometry.dispose();
    this.canvasMesh.geometry = new THREE.PlaneGeometry(planeW, planeH);

    const footerY = -panelH / 2 + 0.055;
    this.prevNav.containerEl.setAttribute('position', `${-panelW / 2 + 0.11} ${footerY} 0.015`);
    this.nextNav.containerEl.setAttribute('position', `${panelW / 2 - 0.11} ${footerY} 0.015`);
    this.pageLabelEl.setAttribute('position', `0 ${footerY} 0.015`);
  }

  private async syncDocumentAndWindow(): Promise<void> {
    const version = ++this.syncVersion;
    this.isLoadingDoc = true;

    if (this.pdfDoc) {
      await this.pdfDoc.cleanup();
      this.pdfDoc = null;
    }
    this.loadedUrl = this.data.pdfUrl;

    if (this.pdfBytes && this.pdfBytes.byteLength > 0) {
      try {
        // envia uma cópia do buffer para evitar que o web worker do pdf.js transfira e invalide o array original
        const loadingTask = pdfjsLib.getDocument({ data: this.pdfBytes.slice(0) });
        const loadedDoc = await loadingTask.promise;
        if (version !== this.syncVersion) {
          void loadedDoc.cleanup();
          return;
        }
        this.pdfDoc = loadedDoc;
        this.totalPages = Math.max(1, this.pdfDoc.numPages);
        this.data.pageCount = this.totalPages;
        this.currentPage = clampPdfPage(this.currentPage, this.totalPages);
      } catch (error) {
        logger.warn('pdf.js load from direct bytes failed', error);
        this.pdfDoc = null;
      }
    } else if (this.data.pdfUrl) {
      try {
        const loadingTask = pdfjsLib.getDocument({ url: this.data.pdfUrl });
        const loadedDoc = await loadingTask.promise;
        if (version !== this.syncVersion) {
          void loadedDoc.cleanup();
          return;
        }
        this.pdfDoc = loadedDoc;
        this.totalPages = Math.max(1, this.pdfDoc.numPages);
        this.data.pageCount = this.totalPages;
        this.currentPage = clampPdfPage(this.currentPage, this.totalPages);
      } catch (error) {
        logger.warn(
          'pdf.js load from url failed, falling back to offline synthetic page canvas',
          error,
        );
        this.pdfDoc = null;
      }
    }

    if (version !== this.syncVersion) return;

    // avalia a proporção (aspect ratio) da primeira página do pdf para ajustar o tamanho do painel sem distorção
    if (this.pdfDoc) {
      try {
        const firstPage = await this.pdfDoc.getPage(1);
        if (version !== this.syncVersion) return;
        const firstViewport = firstPage.getViewport({ scale: 1 });
        const aspectRatio = firstViewport.width / Math.max(1, firstViewport.height);
        this.applyResponsiveAspectRatio(aspectRatio);
      } catch {
        this.applyResponsiveAspectRatio(0.707);
      }
    } else {
      this.applyResponsiveAspectRatio(CANVAS_WIDTH_PX / CANVAS_HEIGHT_PX);
    }

    this.isLoadingDoc = false;
    // limpa qualquer textura provisória gerada antes da resolução assíncrona do documento real
    this.evictAllTextures();
    await this.refreshWindow();
  }

  private async refreshWindow(): Promise<void> {
    if (this.isLoadingDoc) return;
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
      const maxDimensionPx = 1600;
      const scale =
        maxDimensionPx / Math.max(1, Math.max(baseViewport.width, baseViewport.height));
      const viewport = page.getViewport({ scale });
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = '#FFFFFF';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, canvas, viewport }).promise;
      }
    } else if (this.syntheticProvider) {
      const content = this.syntheticProvider(pageNumber);
      drawSyntheticPageToCanvas(canvas, content);
    } else {
      this.drawLoadingPageToCanvas(canvas, pageNumber);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  private drawLoadingPageToCanvas(canvas: HTMLCanvasElement, pageNumber: number): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const isDark = this.currentTheme === 'dark-glass';
    ctx.fillStyle = isDark ? '#121316' : '#F5F3EB';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = isDark ? '#F5F3EB' : '#121316';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText(this.data.sourceTitle || 'Documento PDF', 40, 70);

    ctx.strokeStyle = isDark ? '#27272A' : '#E4E4E7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, 94);
    ctx.lineTo(canvas.width - 40, 94);
    ctx.stroke();

    ctx.fillStyle = isDark ? '#A1A1AA' : '#52525B';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(`Página ${pageNumber} de ${this.totalPages}`, 40, 150);
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
    width: { type: 'number', default: 0.76 },
    height: { type: 'number', default: 0.88 },
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
