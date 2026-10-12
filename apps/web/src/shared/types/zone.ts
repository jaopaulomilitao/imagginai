import type { EnvironmentPreset, PanelRadiusM } from '../../zone/config/constants';

// estrutura de zona e layout persistido (seção 3.3)
export interface PanelLayout {
  panelId: string;
  yawDeg: number;
  pitchDeg: number;
  radiusM: PanelRadiusM;
}

export interface Zone {
  id: string;
  name: string;
  environment: EnvironmentPreset;
  sourceIds: string[];
  packId: string | null;
  layout: PanelLayout[];
  createdAt: string;
  updatedAt: string;
}
