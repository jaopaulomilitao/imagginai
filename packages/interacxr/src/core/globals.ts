import { InteractionManager } from './interaction-manager';

// estado global herdado da versão javascript original (defeito 8, removido na refatoração)
declare global {
  interface Window {
    ixrInteractionManager: InteractionManager;
    ixrHUD?: unknown;
  }
}

window.ixrInteractionManager = new InteractionManager();
