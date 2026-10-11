import AFRAME, { type Component, type Entity } from 'aframe';
import type { Mesh, ShaderMaterial } from 'three';

import { logger } from '../core/logger';
import { passthroughShader } from '../passthrough/passthrough-shader';
import { getInteracxrSystem } from './interacxr-system';
import { THREE } from './three';

type PassthroughData = Record<string, never>;

export interface PassthroughComponent extends Component<PassthroughData> {
  controller?: PassthroughController;
}

// o plano continua distante nesta etapa; sua altura vem do mesmo perfil de calibração das mãos
const PLANE_DISTANCE = 50;

export class PassthroughController {
  private material: ShaderMaterial | null = null;
  private videoPlane: Mesh | null = null;

  constructor(private readonly el: Entity) {}

  async startCamera(): Promise<void> {
    try {
      // o vídeo é o mesmo usado pelo rastreamento de mãos (camera service compartilhado)
      const video = await getInteracxrSystem(this.el).startCamera();
      this.setupVideoPlane(video);
      await this.el.sceneEl.enterVR();
    } catch (error) {
      logger.error('camera permission is required for xr mode', error);
    }
  }

  // o zoom fixo (1.1) foi removido: ampliava o vídeo em relação às mãos virtuais
  private applyCalibration(): void {
    if (!this.material) return;
    const uniforms = this.material.uniforms;
    if (uniforms.k1) uniforms.k1.value = getInteracxrSystem(this.el).calibration.k1;
    if (uniforms.zoomLevel) uniforms.zoomLevel.value = 1;
  }

  dispose(): void {
    if (this.videoPlane) this.el.object3D.remove(this.videoPlane);
  }

  private setupVideoPlane(video: HTMLVideoElement): void {
    const texture = new THREE.VideoTexture(video);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(passthroughShader.uniforms),
      vertexShader: passthroughShader.vertexShader,
      fragmentShader: passthroughShader.fragmentShader,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const videoUniform = this.material.uniforms.videoTexture;
    if (videoUniform) videoUniform.value = texture;
    this.applyCalibration();

    const system = getInteracxrSystem(this.el);
    const plane = system.calibration.projectionPlane(
      video.videoWidth,
      video.videoHeight,
      PLANE_DISTANCE,
    );
    const geometry = new THREE.PlaneGeometry(plane.widthM, plane.heightM);
    this.videoPlane = new THREE.Mesh(geometry, this.material);
    this.videoPlane.position.set(0, 0, -PLANE_DISTANCE);
    this.el.object3D.add(this.videoPlane);
  }
}

AFRAME.registerComponent<PassthroughComponent>('xr-passthrough', {
  init() {
    this.controller = new PassthroughController(this.el);
  },
  remove() {
    this.controller?.dispose();
  },
});
