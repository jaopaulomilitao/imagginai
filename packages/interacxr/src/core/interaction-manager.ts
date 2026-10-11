export type InteractionMode = string;

export interface InteractionState {
  mode: InteractionMode;
  owner: unknown;
}

export type InteractionListener = (state: InteractionState) => void;

// arbitra qual interação detém o controle; apenas uma por vez sai do estado ocioso
export class InteractionManager {
  private mode: InteractionMode = 'idle';
  private owner: unknown = null;
  private readonly listeners: InteractionListener[] = [];

  request(mode: InteractionMode, owner: unknown = null): boolean {
    if (this.mode !== 'idle') return false;
    this.setState(mode, owner);
    return true;
  }

  force(mode: InteractionMode, owner: unknown = null): boolean {
    this.setState(mode, owner);
    return true;
  }

  release(owner: unknown = null): void {
    if (owner && this.owner !== owner) return;
    this.setState('idle', null);
  }

  isIdle(): boolean {
    return this.mode === 'idle';
  }

  isActive(mode: InteractionMode): boolean {
    return this.mode === mode;
  }

  getMode(): InteractionMode {
    return this.mode;
  }

  subscribe(listener: InteractionListener): void {
    this.listeners.push(listener);
  }

  unsubscribe(listener: InteractionListener): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) this.listeners.splice(index, 1);
  }

  private setState(mode: InteractionMode, owner: unknown): void {
    this.mode = mode;
    this.owner = owner;
    for (const listener of this.listeners) listener({ mode: this.mode, owner: this.owner });
  }
}
