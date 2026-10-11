import { InteractionManager } from './interaction-manager';

// estado global herdado da versão javascript original (defeito 8, removido na refatoração)
export interface LegacyCalibration {
  baseDepth: number;
  planeWidth: number;
  planeHeight: number;
}

declare global {
  interface Window {
    ixrInteractionManager: InteractionManager;
    ixrCalibration?: LegacyCalibration;
    ixrHUD?: unknown;
  }
}

window.ixrInteractionManager = new InteractionManager();
