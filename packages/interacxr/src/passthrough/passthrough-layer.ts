import type { Mesh, Object3D, PlaneGeometry, ShaderMaterial, VideoTexture } from 'three';

import { THREE } from '../aframe/three';
import type { ProjectionPlane } from '../calibration/calibration-profile';
import {
  MASK_MODE,
  type MaskMode,
  passthroughFragmentShader,
  passthroughVertexShader,
} from './passthrough-shader';

export interface PassthroughLayerOptions {
  opacity: number;
  maskMode: MaskMode;
  feather: number;
  k1: number;
}

export const DEFAULT_PASSTHROUGH_OPTIONS: PassthroughLayerOptions = {
  opacity: 1,
  maskMode: MASK_MODE.FULL,
  feather: 0.08,
  k1: 0,
};

// desenhado antes de tudo e sem teste de profundidade: o vídeo funciona como fundo da cena
const BACKGROUND_RENDER_ORDER = -1;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// plano de vídeo preso à cabeça, dimensionado pelo mesmo plano de projeção usado pelas mãos
export class PassthroughLayer {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly texture: VideoTexture;

  constructor(
    video: HTMLVideoElement,
    plane: ProjectionPlane,
    options: Partial<PassthroughLayerOptions> = {},
  ) {
    const settings = { ...DEFAULT_PASSTHROUGH_OPTIONS, ...options };
    this.texture = new THREE.VideoTexture(video);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.createMaterial(settings));
    this.mesh.renderOrder = BACKGROUND_RENDER_ORDER;
    this.mesh.frustumCulled = false;
    this.resize(plane);
  }

  get opacity(): number {
    return this.uniform('uOpacity');
  }

  // a cabeça é o pai: o plano acompanha o olhar a uma distância fixa
  attachTo(head: Object3D): void {
    head.add(this.mesh);
  }

  resize(plane: ProjectionPlane): void {
    this.mesh.scale.set(plane.widthM, plane.heightM, 1);
    this.mesh.position.set(0, 0, -plane.distanceM);
  }

  setOpacity(opacity: number): void {
    this.setUniform('uOpacity', clampUnit(opacity));
    this.mesh.visible = opacity > 0;
  }

  setMaskMode(mode: MaskMode): void {
    this.setUniform('uMaskMode', mode);
  }

  setFeather(feather: number): void {
    this.setUniform('uFeather', clampUnit(feather));
  }

  setK1(k1: number): void {
    this.setUniform('uK1', k1);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
  }

  private createMaterial(settings: PassthroughLayerOptions): ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uVideo: { value: this.texture },
        uOpacity: { value: clampUnit(settings.opacity) },
        uMaskMode: { value: settings.maskMode },
        uFeather: { value: clampUnit(settings.feather) },
        uK1: { value: settings.k1 },
      },
      vertexShader: passthroughVertexShader,
      fragmentShader: passthroughFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }

  private uniform(name: string): number {
    const value: unknown = this.mesh.material.uniforms[name]?.value;
    return typeof value === 'number' ? value : 0;
  }

  private setUniform(name: string, value: number): void {
    const uniform = this.mesh.material.uniforms[name];
    if (uniform) uniform.value = value;
  }
}
