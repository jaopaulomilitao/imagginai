export type ObserverFactory = (onChange: () => void) => { disconnect(): void };

// a lista só é reconstruída quando o dom muda (entidades ou classes), não a cada quadro
export const OBSERVED_MUTATIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class'],
};

export function domObserverFactory(root: Node): ObserverFactory {
  return (onChange) => {
    const observer = new MutationObserver(onChange);
    observer.observe(root, OBSERVED_MUTATIONS);
    return observer;
  };
}

// cache de alvos interativos com invalidação por observação de mutações
export class TargetCache<T> {
  private targets: T[] = [];
  private dirty = true;
  private readonly observer: { disconnect(): void };

  constructor(
    private readonly query: () => T[],
    observe: ObserverFactory,
  ) {
    this.observer = observe(() => this.invalidate());
  }

  // a lista devolvida é compartilhada e não deve ser alterada por quem a consome
  get(): T[] {
    if (this.dirty) {
      this.targets = this.query();
      this.dirty = false;
    }
    return this.targets;
  }

  invalidate(): void {
    this.dirty = true;
  }

  dispose(): void {
    this.observer.disconnect();
    this.targets = [];
  }
}
