import AFRAME, { type Component, type Entity } from 'aframe';
import type { RotatableComponent } from 'interacxr';
import type { AnimationAction, AnimationMixer, Group, Mesh } from 'three';

import { normalizeModelToUnit } from '../../shared/three/normalize-model';
import type { SsoAnnotation, SpecialStudyObjectAsset } from '../../shared/types/study-pack';
import type { ZoneTheme } from '../config/constants';
import '../systems/rounded-shape';
import {
  resolveInitialTheme,
  ZONE_THEME_CHANGE_EVENT,
  ZONE_THEME_STORAGE_KEY,
} from '../systems/theme-controller';
import { ZONE_GOTO_PDF_PAGE_EVENT } from './imx-node-analysis-panel';

export const SSO_ANNOTATION_SELECT_EVENT = 'imx-sso-annotation-select';

// tamanho final (maior dimensão) do objeto no mundo VR, em metros
const SSO_WORLD_SIZE_M = 0.5;

export interface SsoAnnotationSelectDetail {
  readonly assetId: string;
  readonly annotation: SsoAnnotation;
  readonly sourceTitle: string;
}

export interface SpecialStudyObjectData {
  assetId: string;
  sourceTitle: string;
}

export interface SpecialStudyObjectComponent extends Component<SpecialStudyObjectData> {
  controller?: SpecialStudyObjectBridge;
}

interface AnnotationRef {
  readonly annotation: SsoAnnotation;
  readonly pinEl: Entity;
  readonly coreSphereEl: Entity;
  readonly borderSphereEl: Entity;
  readonly hitSphereEl: Entity;
  isHovered: boolean;
}

/**
 * Ponte controladora para o Objeto de Estudo Especial (OEE) em WebXR.
 * Gerencia o modelo 3D GLB, iluminação dedicada, animações em loop, rotação pela mão esquerda e pontos discretos de anotação.
 */
export class SpecialStudyObjectBridge {
  private currentTheme: ZoneTheme = 'dark-glass';
  private asset: SpecialStudyObjectAsset | null = null;
  private mixer: AnimationMixer | null = null;
  private actions: AnimationAction[] = [];
  private activeAnnotationId: string | null = null;
  private currentActivePageAnchor: number | null = null;
  private currentModelScale = 1.0;

  private rootEl: Entity;
  private volumeGroupEl: Entity;
  private hitVolumeEl: Entity;
  private modelContainerEl: Entity;
  private modelEl: Entity;
  private annotationCardEl: Entity;
  private cardBgEl: Entity;
  private cardBorderEl: Entity;
  private cardBadgeEl: Entity;
  private cardTitleEl: Entity;
  private cardBodyEl: Entity;
  private cardFooterEl: Entity;
  private cardPdfBtnEl: Entity;
  private cardPdfTxtEl: Entity;
  private cardCloseBtnEl: Entity;

  private annotationRefs: AnnotationRef[] = [];
  private tmpCamQuat = new AFRAME.THREE.Quaternion();
  private tmpParentQuat = new AFRAME.THREE.Quaternion();
  private tmpBillboardQuat = new AFRAME.THREE.Quaternion();

  constructor(private readonly el: Entity) {
    let storedPref: string | null = null;
    try {
      storedPref = localStorage.getItem(ZONE_THEME_STORAGE_KEY);
    } catch {
      // ignora caso localStorage não esteja acessível
    }
    this.currentTheme = resolveInitialTheme(storedPref);

    this.rootEl = document.createElement('a-entity') as Entity;
    this.el.appendChild(this.rootEl);

    // desativa o painel padrão com moldura retangular bege para exibir o 3d livremente (frameless)
    this.el.setAttribute('imx-panel', {
      frameless: true,
      body: '',
      title: '',
    });

    // iluminação dedicada de 3 pontos para realçar contornos anatômicos e brilho natural do tecido
    const keyLight = document.createElement('a-entity') as Entity;
    keyLight.setAttribute(
      'light',
      'type: directional; color: #FFFFFF; intensity: 1.8; castShadow: false',
    );
    keyLight.setAttribute('position', '1.4 2.4 2.0');
    this.rootEl.appendChild(keyLight);

    const fillLight = document.createElement('a-entity') as Entity;
    fillLight.setAttribute(
      'light',
      'type: directional; color: #38BDF8; intensity: 0.9; castShadow: false',
    );
    fillLight.setAttribute('position', '-1.4 -0.6 1.2');
    this.rootEl.appendChild(fillLight);

    const rimLight = document.createElement('a-entity') as Entity;
    rimLight.setAttribute('light', 'type: point; color: #F06131; intensity: 1.1; distance: 3.2');
    rimLight.setAttribute('position', '0 0.8 -1.0');
    this.rootEl.appendChild(rimLight);

    // habilita rotação nativa do modelo tridimensional com a mão esquerda
    this.el.classList.add('rotatable');
    this.el.setAttribute('data-rotatable', 'true');

    // grupo rotacionável contendo o modelo e as anotações ancoradas
    this.volumeGroupEl = document.createElement('a-entity') as Entity;
    this.volumeGroupEl.setAttribute('data-rotatable-volume', 'true');
    this.volumeGroupEl.setAttribute('position', '0 0 0');
    this.rootEl.appendChild(this.volumeGroupEl);

    // volume de hit ergonômico para o cursor ao redor do objeto (~48cm)
    this.hitVolumeEl = document.createElement('a-entity') as Entity;
    this.hitVolumeEl.setAttribute('data-hit-volume', 'true');
    this.hitVolumeEl.setAttribute('data-ixr-ignore-rotate', 'true');
    this.hitVolumeEl.setAttribute(
      'geometry',
      'primitive: box; width: 0.52; height: 0.52; depth: 0.42',
    );
    this.hitVolumeEl.setAttribute('material', 'visible: false');
    this.volumeGroupEl.appendChild(this.hitVolumeEl);

    this.el.setAttribute(
      'ixr-rotatable',
      'targetSelector: [data-rotatable-volume]; fadeOutDelayMs: 2000; easing: 0.16; rotationSpeed: 3.2; boxOpacity: 0.65; boxPadding: 0.03',
    );

    this.modelContainerEl = document.createElement('a-entity') as Entity;
    this.volumeGroupEl.appendChild(this.modelContainerEl);

    this.modelEl = document.createElement('a-entity') as Entity;
    this.modelContainerEl.appendChild(this.modelEl);

    // constrói o card flutuante de detalhes de anotação posicionado ao lado/frente do coração
    this.annotationCardEl = document.createElement('a-entity') as Entity;
    this.annotationCardEl.setAttribute('position', '0.38 0.01 0.10');
    this.annotationCardEl.setAttribute('visible', 'false');

    const cardWidth = 0.50;
    const cardHeight = 0.36;

    this.cardBgEl = document.createElement('a-entity') as Entity;
    this.cardBgEl.setAttribute(
      'geometry',
      `primitive: rounded-rect; width: ${cardWidth}; height: ${cardHeight}; radius: 0.02`,
    );
    this.cardBgEl.setAttribute(
      'material',
      'shader: flat; color: #0A0F1D; opacity: 0.94; transparent: true',
    );
    this.annotationCardEl.appendChild(this.cardBgEl);

    this.cardBorderEl = document.createElement('a-entity') as Entity;
    this.cardBorderEl.setAttribute(
      'geometry',
      `primitive: rounded-rect; width: ${cardWidth + 0.004}; height: ${cardHeight + 0.004}; radius: 0.022`,
    );
    this.cardBorderEl.setAttribute(
      'material',
      'shader: flat; color: #F06131; opacity: 0.65; transparent: true; wireframe: true',
    );
    this.cardBorderEl.setAttribute('position', '0 0 -0.002');
    this.annotationCardEl.appendChild(this.cardBorderEl);

    this.cardBadgeEl = document.createElement('a-troika-text') as Entity;
    this.cardBadgeEl.setAttribute('value', 'ANÁLISE ANATÔMICA • OEE');
    this.cardBadgeEl.setAttribute('font-size', '0.012');
    this.cardBadgeEl.setAttribute('font-weight', 'bold');
    this.cardBadgeEl.setAttribute('color', '#F06131');
    this.cardBadgeEl.setAttribute('position', '-0.21 0.14 0.01');
    this.cardBadgeEl.setAttribute('anchor', 'left');
    this.cardBadgeEl.setAttribute('baseline', 'top');
    this.annotationCardEl.appendChild(this.cardBadgeEl);

    this.cardTitleEl = document.createElement('a-troika-text') as Entity;
    this.cardTitleEl.setAttribute('value', 'Estrutura Anatômica');
    this.cardTitleEl.setAttribute('font-size', '0.023');
    this.cardTitleEl.setAttribute('font-weight', 'bold');
    this.cardTitleEl.setAttribute('color', '#FFFFFF');
    this.cardTitleEl.setAttribute('max-width', '0.38');
    this.cardTitleEl.setAttribute('position', '-0.21 0.11 0.01');
    this.cardTitleEl.setAttribute('anchor', 'left');
    this.cardTitleEl.setAttribute('baseline', 'top');
    this.annotationCardEl.appendChild(this.cardTitleEl);

    const dividerEl = document.createElement('a-plane') as Entity;
    dividerEl.setAttribute('width', '0.42');
    dividerEl.setAttribute('height', '0.002');
    dividerEl.setAttribute('position', '0 0.065 0.005');
    dividerEl.setAttribute(
      'material',
      'shader: flat; color: #F06131; opacity: 0.4; transparent: true',
    );
    this.annotationCardEl.appendChild(dividerEl);

    this.cardBodyEl = document.createElement('a-troika-text') as Entity;
    this.cardBodyEl.setAttribute('value', '');
    this.cardBodyEl.setAttribute('font-size', '0.015');
    this.cardBodyEl.setAttribute('color', '#E2E8F0');
    this.cardBodyEl.setAttribute('max-width', '0.42');
    this.cardBodyEl.setAttribute('line-height', '1.4');
    this.cardBodyEl.setAttribute('position', '-0.21 0.045 0.01');
    this.cardBodyEl.setAttribute('anchor', 'left');
    this.cardBodyEl.setAttribute('baseline', 'top');
    this.annotationCardEl.appendChild(this.cardBodyEl);

    this.cardFooterEl = document.createElement('a-troika-text') as Entity;
    this.cardFooterEl.setAttribute('value', '');
    this.cardFooterEl.setAttribute('font-size', '0.011');
    this.cardFooterEl.setAttribute('color', '#94A3B8');
    this.cardFooterEl.setAttribute('position', '-0.21 -0.13 0.01');
    this.cardFooterEl.setAttribute('anchor', 'left');
    this.cardFooterEl.setAttribute('baseline', 'bottom');
    this.annotationCardEl.appendChild(this.cardFooterEl);

    this.cardPdfBtnEl = document.createElement('a-entity') as Entity;
    this.cardPdfBtnEl.classList.add('interactable');
    this.cardPdfBtnEl.setAttribute('geometry', 'primitive: plane; width: 0.18; height: 0.038');
    this.cardPdfBtnEl.setAttribute(
      'material',
      'shader: flat; color: #1E293B; opacity: 0.9; transparent: true',
    );
    this.cardPdfBtnEl.setAttribute('position', '0.11 -0.125 0.01');
    this.cardPdfBtnEl.setAttribute('visible', 'false');

    this.cardPdfTxtEl = document.createElement('a-troika-text') as Entity;
    this.cardPdfTxtEl.setAttribute('value', 'Ver no PDF ↗');
    this.cardPdfTxtEl.setAttribute('font-size', '0.012');
    this.cardPdfTxtEl.setAttribute('color', '#38BDF8');
    this.cardPdfTxtEl.setAttribute('align', 'center');
    this.cardPdfTxtEl.setAttribute('position', '0 0 0.005');
    this.cardPdfBtnEl.appendChild(this.cardPdfTxtEl);

    this.cardPdfBtnEl.addEventListener('click', () => {
      if (this.currentActivePageAnchor) {
        this.el.sceneEl?.emit(ZONE_GOTO_PDF_PAGE_EVENT, { page: this.currentActivePageAnchor });
      }
    });
    this.annotationCardEl.appendChild(this.cardPdfBtnEl);

    this.cardCloseBtnEl = document.createElement('a-entity') as Entity;
    this.cardCloseBtnEl.classList.add('interactable');
    this.cardCloseBtnEl.setAttribute('geometry', 'primitive: plane; width: 0.04; height: 0.04');
    this.cardCloseBtnEl.setAttribute(
      'material',
      'shader: flat; color: #1E293B; opacity: 0.9; transparent: true',
    );
    this.cardCloseBtnEl.setAttribute('position', '0.21 0.135 0.01');
    const closeTxt = document.createElement('a-troika-text') as Entity;
    closeTxt.setAttribute('value', '✕');
    closeTxt.setAttribute('font-size', '0.02');
    closeTxt.setAttribute('color', '#FFFFFF');
    closeTxt.setAttribute('align', 'center');
    closeTxt.setAttribute('position', '0 0 0.005');
    this.cardCloseBtnEl.appendChild(closeTxt);
    this.cardCloseBtnEl.addEventListener('click', () => {
      this.closeAnnotationCard();
    });
    this.annotationCardEl.appendChild(this.cardCloseBtnEl);

    this.rootEl.appendChild(this.annotationCardEl);

    window.addEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
  }

  private readonly onThemeChange = (evt: Event): void => {
    const detail = (evt as CustomEvent<{ themeId: ZoneTheme }>).detail;
    if (detail?.themeId) {
      this.currentTheme = detail.themeId;
      this.applyTheme();
    }
  };

  setAssetData(asset: SpecialStudyObjectAsset): void {
    this.asset = asset;
    this.activeAnnotationId = null;
    this.closeAnnotationCard();

    // garante ocultação de painéis de fundo e cabeçalhos legados
    this.el.setAttribute('imx-panel', {
      frameless: true,
      body: '',
      title: '',
    });

    const onModelLoaded = (evt?: CustomEvent<{ model: Group }>) => {
      const model =
        evt?.detail?.model ?? (this.modelEl.getObject3D('mesh') as Group | undefined);
      if (!model) return;

      // ativa animações do modelo em loop contínuo (ex.: batimento cardíaco)
      if (model.animations && model.animations.length > 0) {
        const mixer = new AFRAME.THREE.AnimationMixer(model);
        this.mixer = mixer;
        this.actions = model.animations.map((clip) => {
          const action = mixer.clipAction(clip);
          action.setLoop(AFRAME.THREE.LoopRepeat, Infinity);
          action.play();
          return action;
        });
      }

      // assegura que nenhuma malha seja descartada pelo frustum culling, calibra materiais e renderOrder para passthrough
      model.traverse((child) => {
        if ((child as Mesh).isMesh) {
          child.frustumCulled = false;
          child.castShadow = false;
          child.receiveShadow = false;
          child.renderOrder = 1;
          const mesh = child as Mesh;
          if (mesh.material) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat) => {
              mat.side = AFRAME.THREE.DoubleSide;
              mat.transparent = true;
              mat.depthWrite = true;
              mat.depthTest = true;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const pbr = mat as any;
              if ('metalness' in pbr) {
                pbr.metalness = 0.05;
              }
              if ('roughness' in pbr) {
                pbr.roughness = 0.55;
              }
              mat.needsUpdate = true;
            });
          }
        }
      });

      // centraliza o modelo na origem (0, 0, 0) e o normaliza para 1 unidade de maior dimensão;
      // as coordenadas dos marcadores ficam, assim, no intervalo [-0.5, 0.5] independente do arquivo
      normalizeModelToUnit(AFRAME.THREE, model, this.mixer);

      // o contêiner define o tamanho final no mundo (~0.5m)
      const worldSize = SSO_WORLD_SIZE_M * (asset.scale && asset.scale[0] > 0 ? asset.scale[0] : 1);
      this.currentModelScale = worldSize;
      this.modelContainerEl.setAttribute('scale', `${worldSize} ${worldSize} ${worldSize}`);

      this.rebuildAnnotationsDom();

      // recalcula o volume de rotação com o tamanho final (evita a caixa gigante do tamanho nativo)
      const rotatable = this.el.components['ixr-rotatable'] as RotatableComponent | undefined;
      rotatable?.controller?.recalculateBounds();
    };

    // carrega modelo 3D GLB
    this.modelEl.setAttribute('gltf-model', asset.modelUrl);

    const existingMesh = this.modelEl.getObject3D('mesh') as Group | undefined;
    if (existingMesh) {
      onModelLoaded();
    } else {
      this.modelEl.addEventListener('model-loaded', onModelLoaded as unknown as EventListener, {
        once: true,
      });
    }
  }

  private rebuildAnnotationsDom(): void {
    // limpa anotações anteriores
    for (const ref of this.annotationRefs) {
      if (ref.pinEl.parentNode) {
        ref.pinEl.parentNode.removeChild(ref.pinEl);
      }
    }
    this.annotationRefs = [];

    if (!this.asset) return;

    const s = this.currentModelScale || 1.0;
    // dimensões discretas calibradas no espaço local do modelo (equivalente a 12mm e 16mm no mundo VR)
    const localRadius = 0.012 / s;
    const localBorderRadius = 0.016 / s;
    const localHitRadius = 0.026 / s;

    for (const ann of this.asset.annotations) {
      const pinEl = document.createElement('a-entity') as Entity;
      pinEl.setAttribute('position', `${ann.position[0]} ${ann.position[1]} ${ann.position[2]}`);
      pinEl.classList.add('interactable');

      // 1. ponto discreto central branco
      const coreSphereEl = document.createElement('a-sphere') as Entity;
      coreSphereEl.classList.add('interactable');
      coreSphereEl.setAttribute('radius', String(localRadius));
      coreSphereEl.setAttribute(
        'material',
        'shader: flat; color: #FFFFFF; opacity: 0.98; transparent: true',
      );
      pinEl.appendChild(coreSphereEl);

      // 2. traçado preto nítido e discreto em 360 graus via técnica de casco invertido (BackSide)
      const borderSphereEl = document.createElement('a-sphere') as Entity;
      borderSphereEl.setAttribute('radius', String(localBorderRadius));
      borderSphereEl.setAttribute(
        'material',
        'shader: flat; color: #000000; side: back; opacity: 1.0',
      );
      pinEl.appendChild(borderSphereEl);

      // 3. volume de clique invisível generoso para facilitar acionamento via retículo e feixe
      const hitSphereEl = document.createElement('a-sphere') as Entity;
      hitSphereEl.classList.add('interactable');
      hitSphereEl.setAttribute('radius', String(localHitRadius));
      hitSphereEl.setAttribute('material', 'visible: false');
      pinEl.appendChild(hitSphereEl);

      const ref: AnnotationRef = {
        annotation: ann,
        pinEl,
        coreSphereEl,
        borderSphereEl,
        hitSphereEl,
        isHovered: false,
      };

      pinEl.addEventListener('mouseenter', () => {
        ref.isHovered = true;
        pinEl.setAttribute('scale', '1.25 1.25 1.25');
        borderSphereEl.setAttribute('material', 'shader: flat; color: #F06131; side: back');
      });

      pinEl.addEventListener('mouseleave', () => {
        ref.isHovered = false;
        pinEl.setAttribute('scale', '1 1 1');
        const isSelected = this.activeAnnotationId === ann.id;
        borderSphereEl.setAttribute(
          'material',
          `shader: flat; color: ${isSelected ? '#FFFFFF' : '#000000'}; side: back`,
        );
        coreSphereEl.setAttribute(
          'material',
          `shader: flat; color: ${isSelected ? '#F06131' : '#FFFFFF'}; opacity: 0.98; transparent: true`,
        );
      });

      pinEl.addEventListener('click', () => {
        this.selectAnnotation(ann.id);
      });

      // anexa como filho do contêiner para rotacionar perfeitamente fixado à superfície do órgão
      this.modelContainerEl.appendChild(pinEl);
      this.annotationRefs.push(ref);

      // renderOrder 2 assegura que os marcadores fiquem desenhados sobre a superfície do modelo (renderOrder 1)
      const applyPinRenderOrder = (): void => {
        pinEl.object3D?.traverse((obj) => {
          obj.renderOrder = 2;
        });
      };
      applyPinRenderOrder();
      pinEl.addEventListener('loaded', applyPinRenderOrder);
    }
  }

  selectAnnotation(annId: string): void {
    if (!this.asset) return;
    const target = this.asset.annotations.find((a) => a.id === annId);
    if (!target) return;

    this.activeAnnotationId = annId;

    // atualiza cores dos marcadores: o ativo ganha destaque vibrante
    for (const ref of this.annotationRefs) {
      const isSelected = ref.annotation.id === annId;
      ref.pinEl.setAttribute('scale', isSelected ? '1.25 1.25 1.25' : '1 1 1');
      ref.coreSphereEl.setAttribute(
        'material',
        `shader: flat; color: ${isSelected ? '#F06131' : '#FFFFFF'}; opacity: 0.98; transparent: true`,
      );
      ref.borderSphereEl.setAttribute(
        'material',
        `shader: flat; color: ${isSelected ? '#FFFFFF' : '#000000'}; side: back`,
      );
    }

    // preenche o card flutuante posicionado na frente e ao lado do coração
    this.cardTitleEl.setAttribute('value', target.title);
    this.cardBodyEl.setAttribute('value', target.description);
    this.cardFooterEl.setAttribute('value', `${this.asset.title} • IMAGGINAI`);

    if (target.pageAnchor) {
      this.currentActivePageAnchor = target.pageAnchor;
      this.cardPdfTxtEl.setAttribute('value', `Ver no PDF (pág. ${target.pageAnchor}) ↗`);
      this.cardPdfBtnEl.setAttribute('visible', 'true');
    } else {
      this.currentActivePageAnchor = null;
      this.cardPdfBtnEl.setAttribute('visible', 'false');
    }

    this.annotationCardEl.setAttribute('visible', 'true');
    this.ensureCardRenderOrder();

    // emite evento para telemetria ou integração externa
    this.el.emit(SSO_ANNOTATION_SELECT_EVENT, {
      assetId: this.asset.id,
      annotation: target,
      sourceTitle: this.asset.title,
    } as SsoAnnotationSelectDetail);
  }

  closeAnnotationCard(): void {
    this.activeAnnotationId = null;
    this.currentActivePageAnchor = null;
    this.annotationCardEl.setAttribute('visible', 'false');
    for (const ref of this.annotationRefs) {
      ref.pinEl.setAttribute('scale', '1 1 1');
      ref.coreSphereEl.setAttribute(
        'material',
        'shader: flat; color: #FFFFFF; opacity: 0.98; transparent: true',
      );
      ref.borderSphereEl.setAttribute('material', 'shader: flat; color: #000000; side: back');
    }
  }

  tick(_time: number, timeDelta: number): void {
    const deltaSec = Math.min(0.1, (timeDelta || 16.6) / 1000);

    // atualiza mixer de animação do Three.js (batimento contínuo do coração)
    if (this.mixer) {
      this.mixer.update(deltaSec);
    }

    // billboarding para que o card de detalhes sempre olhe diretamente para a câmera
    const cam = this.el.sceneEl?.camera;
    if (cam) {
      cam.getWorldQuaternion(this.tmpCamQuat);
      this.volumeGroupEl.object3D.getWorldQuaternion(this.tmpParentQuat);
      this.tmpParentQuat.invert();
      this.tmpBillboardQuat.multiplyQuaternions(this.tmpParentQuat, this.tmpCamQuat);
      this.annotationCardEl.object3D.quaternion.copy(this.tmpBillboardQuat);
    }
  }

  private ensureCardRenderOrder(): void {
    this.annotationCardEl.object3D?.traverse((obj) => {
      obj.renderOrder = 10;
    });
  }

  private applyTheme(): void {
    const isDark = this.currentTheme === 'dark-glass';
    const bgMat = `shader: flat; color: ${isDark ? '#0A0F1D' : '#F8FAFC'}; opacity: 0.94; transparent: true`;
    this.cardBgEl.setAttribute('material', bgMat);
    this.cardTitleEl.setAttribute('color', isDark ? '#FFFFFF' : '#0F172A');
    this.cardBodyEl.setAttribute('color', isDark ? '#E2E8F0' : '#334155');
  }

  destroy(): void {
    window.removeEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
    if (this.mixer) {
      this.actions.forEach((a) => a.stop());
      this.mixer.stopAllAction();
      this.mixer = null;
    }
  }
}

AFRAME.registerComponent<SpecialStudyObjectComponent>('imx-special-study-object', {
  schema: {
    assetId: { type: 'string', default: '' },
    sourceTitle: { type: 'string', default: 'IMAGGINAI' },
  },

  init(): void {
    this.controller = new SpecialStudyObjectBridge(this.el as Entity);
  },

  update(): void {
    // atualizações de dados
  },

  tick(time: number, timeDelta: number): void {
    this.controller?.tick(time, timeDelta);
  },

  remove(): void {
    this.controller?.destroy();
  },
});
