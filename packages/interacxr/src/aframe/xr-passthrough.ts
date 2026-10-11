import AFRAME, { type Component, type Entity } from 'aframe';
import type { Mesh, ShaderMaterial } from 'three';

import { logger } from '../core/logger';
import { passthroughShader } from '../passthrough/passthrough-shader';
import { getInteracxrSystem } from './interacxr-system';
import { THREE } from './three';

interface PassthroughData {
  k1: number;
  zoom: number;
}

export interface PassthroughComponent extends Component<PassthroughData> {
  controller?: PassthroughController;
}

const PLANE_HEIGHT = 18;
const PLANE_DISTANCE = 50;

export class PassthroughController {
  private material: ShaderMaterial | null = null;
  private videoPlane: Mesh | null = null;

  constructor(
    private readonly el: Entity,
    private data: PassthroughData,
  ) {}

  async startCamera(): Promise<void> {
    try {
      // o vídeo é o mesmo usado pelo rastreamento de mãos (camera service compartilhado)
      const video = await getInteracxrSystem(this.el).camera.start();
      this.setupVideoPlane(video);
      await this.el.sceneEl.enterVR();
    } catch (error) {
      logger.error('camera permission is required for xr mode', error);
    }
  }

  update(data: PassthroughData): void {
    this.data = data;
    if (!this.material) return;
    const uniforms = this.material.uniforms;
    if (uniforms.k1) uniforms.k1.value = data.k1;
    if (uniforms.zoomLevel) uniforms.zoomLevel.value = data.zoom;
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
    this.update(this.data);

    const aspect = video.videoWidth / video.videoHeight;
    const geometry = new THREE.PlaneGeometry(PLANE_HEIGHT * aspect, PLANE_HEIGHT);
    this.videoPlane = new THREE.Mesh(geometry, this.material);
    this.videoPlane.position.set(0, 0, -PLANE_DISTANCE);
    this.el.object3D.add(this.videoPlane);
  }
}

AFRAME.registerComponent<PassthroughComponent>('xr-passthrough', {
  schema: {
    k1: { type: 'number', default: 0.05 },
    zoom: { type: 'number', default: 1.1 },
  },
  init() {
    this.controller = new PassthroughController(this.el, this.data);
  },
  update() {
    this.controller?.update(this.data);
  },
  remove() {
    this.controller?.dispose();
  },
});
