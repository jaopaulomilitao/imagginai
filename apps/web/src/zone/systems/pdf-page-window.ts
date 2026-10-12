import { PDF_PAGE_CACHE_RADIUS } from '../config/constants';

export interface PdfWindowPlan {
  readonly currentPage: number;
  readonly pagesToKeep: readonly number[];
  readonly pagesToRender: readonly number[];
  readonly pagesToEvict: readonly number[];
}

export function clampPdfPage(page: number, pageCount: number): number {
  if (!(pageCount >= 1) || !Number.isFinite(pageCount)) {
    throw new RangeError('pageCount must be >= 1');
  }
  const rounded = Math.round(page);
  return Math.min(pageCount, Math.max(1, rounded));
}

// calcula a janela deslizante de páginas (atual +- 1) e quais páginas devem ser renderizadas ou descartadas (seção 2.2)
export function computePdfPageWindow(
  requestedPage: number,
  pageCount: number,
  alreadyCachedPages: readonly number[] = [],
  radius: number = PDF_PAGE_CACHE_RADIUS,
): PdfWindowPlan {
  const currentPage = clampPdfPage(requestedPage, pageCount);
  const minPage = Math.max(1, currentPage - radius);
  const maxPage = Math.min(pageCount, currentPage + radius);

  const pagesToKeep: number[] = [];
  for (let p = minPage; p <= maxPage; p++) {
    pagesToKeep.push(p);
  }

  const cachedSet = new Set(alreadyCachedPages);
  const keepSet = new Set(pagesToKeep);

  // prioriza a página atual antes das adjacentes
  const orderedToRender = [...pagesToKeep].sort(
    (a, b) => Math.abs(a - currentPage) - Math.abs(b - currentPage),
  );
  const pagesToRender = orderedToRender.filter((p) => !cachedSet.has(p));
  const pagesToEvict = alreadyCachedPages.filter((p) => !keepSet.has(p));

  return {
    currentPage,
    pagesToKeep,
    pagesToRender,
    pagesToEvict,
  };
}
