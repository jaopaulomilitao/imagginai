import AFRAME, { type Component, type Entity } from 'aframe';
import {
  classifyFrame,
  type HandDataDetail,
  type HandLandmarks,
  HAND_DATA_EVENT,
  LANDMARK,
} from 'interacxr';
import type { LineBasicMaterial, LineSegments } from 'three';

import type {
  ConceptEdge,
  ConceptGraphAsset,
  ConceptNode,
  StudyCard,
} from '../../shared/types/study-pack';
import { formatCardCitation } from './imx-card-panel';
import {
  ConceptGraphController,
  type ScaledGraphEdge,
  type ScaledGraphNode,
} from '../systems/learning-assets-controller';

export const CONCEPT_GRAPH_NODE_SELECT_EVENT = 'imx-concept-graph-select';

export interface ConceptGraphNodeSelectDetail {
  readonly assetId: string;
  readonly conceptId: string;
  readonly card: StudyCard;
  readonly sourceTitle: string;
}

export interface ConceptGraphData {
  assetId: string;
  sourceTitle: string;
}

export interface ConceptGraphComponent extends Component<ConceptGraphData> {
  controller?: ConceptGraphBridge;
}

interface NodeEntityRefs {
  readonly node: ScaledGraphNode;
  readonly sphereEl: Entity;
  readonly labelEl: Entity;
}

interface EdgeEntityRefs {
  readonly edge: ScaledGraphEdge;
  readonly lineEl: Entity;
}

function createTroikaLabel(text: string, position: string, color: string): Entity {
  const el = document.createElement('a-troika-text') as Entity;
  el.setAttribute('position', position);
  el.setAttribute('value', text);
  el.setAttribute('color', color);
  el.setAttribute('align', 'center');
  el.setAttribute('anchor', 'center');
  el.setAttribute('baseline', 'bottom');
  el.setAttribute('font-size', '0.015');
  el.setAttribute('fontSize', '0.015');
  el.setAttribute('max-width', '0.24');
  el.setAttribute('maxWidth', '0.24');
  el.setAttribute(
    'troika-text',
    `value: ${text}; color: ${color}; fontSize: 0.015; maxWidth: 0.24; align: center; anchor: center; baseline: bottom`,
  );
  return el;
}

// componente espacial do grafo de conceitos sem plano de fundo 2d, com gizmo delimitador e rotação pela mão esquerda (seção 2.1 e 3.1)
export class ConceptGraphBridge {
  private graphController: ConceptGraphController | null = null;
  private readonly volumeGroupEl: Entity;
  private readonly hitVolumeEl: Entity;
  private readonly nodeRefs: NodeEntityRefs[] = [];
  private readonly edgeRefs: EdgeEntityRefs[] = [];

  // gizmo delimitador de caixa com arestas em wireframe branco e opacidade suave
  private wireframeBox: LineSegments | null = null;
  private wireframeMaterial: LineBasicMaterial | null = null;
  private currentBoxOpacity = 0.0;
  private targetBoxOpacity = 0.0;
  private animFrameId: number | null = null;

  // estado de foco e controle de rotação com a mão esquerda
  private isHovered = false;
  private isLeftHandGrabbing = false;
  private lastHandPos: { x: number; y: number } | null = null;
  private handTrackingSource: Entity | null = null;

  // suporte a arrasto por mouse/cursor no ambiente de testes desktop
  private isMouseDown = false;
  private mouseStartX = 0;
  private mouseStartY = 0;

  private readonly onHandData = (event: Event): void => {
    const detail = (event as CustomEvent<HandDataDetail>).detail;
    this.handleHandTracking(detail?.landmarks ?? null);
  };

  private readonly onRayEnter = (): void => {
    this.isHovered = true;
    this.targetBoxOpacity = 0.35;
  };

  private readonly onRayLeave = (): void => {
    this.isHovered = false;
    if (!this.isLeftHandGrabbing && !this.isMouseDown) {
      this.targetBoxOpacity = 0.0;
    }
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    this.isMouseDown = true;
    this.mouseStartX = event.clientX;
    this.mouseStartY = event.clientY;
    this.targetBoxOpacity = 0.45;
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.isMouseDown) return;
    const deltaX = (event.clientX - this.mouseStartX) * 0.007;
    const deltaY = (event.clientY - this.mouseStartY) * 0.007;
    this.mouseStartX = event.clientX;
    this.mouseStartY = event.clientY;

    this.volumeGroupEl.object3D.rotation.y += deltaX;
    this.volumeGroupEl.object3D.rotation.x += deltaY;
  };

  private readonly onMouseUp = (): void => {
    if (!this.isMouseDown) return;
    this.isMouseDown = false;
    if (!this.isHovered) {
      this.targetBoxOpacity = 0.0;
    }
  };

  constructor(
    private readonly el: Entity,
    private data: ConceptGraphData,
  ) {
    // marcação semântica rotatable para identificação do gizmo espacial (seção 3.1)
    this.el.classList.add('rotatable');
    this.el.setAttribute('data-rotatable', 'true');

    // container tridimensional do grafo
    this.volumeGroupEl = document.createElement('a-entity') as Entity;
    this.volumeGroupEl.setAttribute('position', '0 0.02 0.06');
    this.el.appendChild(this.volumeGroupEl);

    // volume invisível de colisão para detecção de foco e interação por raio/toque
    this.hitVolumeEl = document.createElement('a-entity') as Entity;
    this.hitVolumeEl.classList.add('interactable');
    this.hitVolumeEl.setAttribute(
      'geometry',
      'primitive: box; width: 0.86; height: 0.58; depth: 0.38',
    );
    this.hitVolumeEl.setAttribute(
      'material',
      'shader: flat; color: #ffffff; opacity: 0.001; transparent: true; depthWrite: false',
    );
    this.volumeGroupEl.appendChild(this.hitVolumeEl);

    this.createWireframeGizmo();
    this.setupListeners();
    this.startAnimationLoop();
  }

  updateData(nextData: ConceptGraphData): void {
    this.data = nextData;
  }

  setGraphData(
    asset: ConceptGraphAsset,
    concepts: readonly ConceptNode[],
    edges: readonly ConceptEdge[],
  ): void {
    this.graphController = new ConceptGraphController(asset, concepts, edges);
    this.rebuildVolumeDom();
    const initialId = this.graphController.getSelectedConceptId();
    if (initialId) {
      this.selectConcept(initialId, false);
    }
  }

  selectConcept(conceptId: string, emitEvent = true): void {
    if (!this.graphController) return;
    const selection = this.graphController.selectNode(conceptId);
    if (!selection) return;

    for (const ref of this.nodeRefs) {
      const isSelected = ref.node.conceptId === conceptId;
      const isConnected = selection.connectedEdges.some(
        (edge) => edge.fromId === ref.node.conceptId || edge.toId === ref.node.conceptId,
      );
      const color = isSelected ? '#EA580C' : isConnected ? '#38BDF8' : '#1E3A8A';
      const scale = isSelected ? '1.35 1.35 1.35' : isConnected ? '1.1 1.1 1.1' : '1 1 1';
      ref.sphereEl.setAttribute('scale', scale);
      ref.sphereEl.setAttribute(
        'material',
        `shader: flat; color: ${color}; opacity: 0.96; transparent: true`,
      );
      const labelColor = isSelected ? '#F59E0B' : '#F5F3EB';
      ref.labelEl.setAttribute('color', labelColor);
      ref.labelEl.setAttribute('troika-text', 'color', labelColor);
    }

    for (const ref of this.edgeRefs) {
      const isConnected = ref.edge.fromId === conceptId || ref.edge.toId === conceptId;
      const lineColor = isConnected ? '#EA580C' : '#64748B';
      const lineOpacity = isConnected ? 0.95 : 0.42;
      ref.lineEl.setAttribute(
        'line',
        `start: ${ref.edge.fromPos.x} ${ref.edge.fromPos.y} ${ref.edge.fromPos.z}; end: ${ref.edge.toPos.x} ${ref.edge.toPos.y} ${ref.edge.toPos.z}; color: ${lineColor}; opacity: ${lineOpacity}`,
      );
    }

    const page = selection.node.anchors[0]?.page ?? 1;
    const footer = formatCardCitation(this.data.sourceTitle || 'Material de estudo', page);
    this.el.setAttribute(
      'imx-panel',
      'title',
      `${this.graphController.asset.title} — ${selection.node.label}`,
    );
    this.el.setAttribute('imx-panel', 'body', '');
    this.el.setAttribute(
      'imx-panel',
      'footer',
      `${selection.node.definition.slice(0, 72)}... | ${footer}`,
    );

    if (emitEvent) {
      const detail: ConceptGraphNodeSelectDetail = {
        assetId: this.data.assetId || this.graphController.asset.id,
        conceptId,
        card: selection.card,
        sourceTitle: this.data.sourceTitle || 'Material de estudo',
      };
      this.el.sceneEl?.emit(CONCEPT_GRAPH_NODE_SELECT_EVENT, detail);
    }
  }

  dispose(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.teardownListeners();
    this.nodeRefs.length = 0;
    this.edgeRefs.length = 0;
    if (this.wireframeBox) {
      this.wireframeBox.geometry.dispose();
      this.wireframeMaterial?.dispose();
      this.wireframeBox.removeFromParent();
    }
    this.volumeGroupEl.remove();
  }

  private createWireframeGizmo(): void {
    const THREE = AFRAME.THREE;
    const boxGeometry = new THREE.BoxGeometry(0.86, 0.58, 0.38);
    const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
    this.wireframeMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      depthTest: false,
    });
    this.wireframeBox = new THREE.LineSegments(edgesGeometry, this.wireframeMaterial);
    this.wireframeBox.renderOrder = 99;
    this.wireframeBox.visible = false;
    this.volumeGroupEl.object3D.add(this.wireframeBox);
  }

  private setupListeners(): void {
    this.hitVolumeEl.addEventListener('mouseenter', this.onRayEnter);
    this.hitVolumeEl.addEventListener('mouseleave', this.onRayLeave);
    this.hitVolumeEl.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);

    const scene = this.el.sceneEl;
    if (scene) {
      const bindTracking = (): void => {
        const cam =
          scene.querySelector('#main-camera') || scene.querySelector('[ixr-hand-tracking]');
        if (cam) {
          this.handTrackingSource = cam as Entity;
          this.handTrackingSource.addEventListener(HAND_DATA_EVENT, this.onHandData);
        }
      };
      if (scene.hasLoaded) {
        bindTracking();
      } else {
        scene.addEventListener('loaded', bindTracking, { once: true });
      }
    }
  }

  private teardownListeners(): void {
    this.hitVolumeEl.removeEventListener('mouseenter', this.onRayEnter);
    this.hitVolumeEl.removeEventListener('mouseleave', this.onRayLeave);
    this.hitVolumeEl.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    if (this.handTrackingSource) {
      this.handTrackingSource.removeEventListener(HAND_DATA_EVENT, this.onHandData);
      this.handTrackingSource = null;
    }
  }

  private startAnimationLoop(): void {
    const tick = (): void => {
      // transição suave de opacidade do cubo delimitador
      if (this.wireframeMaterial && this.wireframeBox) {
        const diff = this.targetBoxOpacity - this.currentBoxOpacity;
        if (Math.abs(diff) > 0.003) {
          this.currentBoxOpacity += diff * 0.14;
          this.wireframeMaterial.opacity = this.currentBoxOpacity;
          this.wireframeBox.visible = this.currentBoxOpacity > 0.005;
        } else if (this.currentBoxOpacity !== this.targetBoxOpacity) {
          this.currentBoxOpacity = this.targetBoxOpacity;
          this.wireframeMaterial.opacity = this.currentBoxOpacity;
          this.wireframeBox.visible = this.currentBoxOpacity > 0.005;
        }
      }
      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private handleHandTracking(landmarks: HandLandmarks | null): void {
    if (!landmarks || landmarks.length === 0) {
      this.isLeftHandGrabbing = false;
      this.lastHandPos = null;
      return;
    }

    const wrist = landmarks[LANDMARK.WRIST];
    if (!wrist) return;

    // identifica mão esquerda no campo de visão (x < 0.55 nas coordenadas normalizadas)
    const isLeftHand = wrist.x < 0.55;
    if (!isLeftHand) {
      this.lastHandPos = null;
      return;
    }

    const pose = classifyFrame(landmarks, this.isLeftHandGrabbing);
    const isClosedFistOrPinch = pose.grab || pose.pinch;

    if (this.isHovered && isClosedFistOrPinch) {
      this.isLeftHandGrabbing = true;
      this.targetBoxOpacity = 0.5;

      if (this.lastHandPos) {
        const deltaX = wrist.x - this.lastHandPos.x;
        const deltaY = wrist.y - this.lastHandPos.y;
        // rotação fluida nos eixos yaw e pitch baseada no delta da mão fechada (seção 3.1)
        this.volumeGroupEl.object3D.rotation.y += deltaX * Math.PI * 3.2;
        this.volumeGroupEl.object3D.rotation.x += deltaY * Math.PI * 3.2;
      }
      this.lastHandPos = { x: wrist.x, y: wrist.y };
    } else {
      this.isLeftHandGrabbing = false;
      this.lastHandPos = null;
      if (!this.isHovered && !this.isMouseDown) {
        this.targetBoxOpacity = 0.0;
      }
    }
  }

  private rebuildVolumeDom(): void {
    this.nodeRefs.length = 0;
    this.edgeRefs.length = 0;

    // remove nós e arestas anteriores preservando hitVolumeEl e wireframe
    const children = [...this.volumeGroupEl.children];
    for (const child of children) {
      if (child !== this.hitVolumeEl) {
        this.volumeGroupEl.removeChild(child);
      }
    }
    if (!this.graphController) return;

    // frameless ativo: oculta placa 2d mantendo alças superiores flutuantes sobre o grafo (seções 2.1 e 3.1)
    this.el.setAttribute('imx-panel', {
      width: 0.84,
      height: 0.56,
      accentColor: '#0284C7',
      frameless: true,
      body: '',
    });

    for (const edge of this.graphController.edges) {
      const lineEl = document.createElement('a-entity') as Entity;
      lineEl.setAttribute(
        'line',
        `start: ${edge.fromPos.x} ${edge.fromPos.y} ${edge.fromPos.z}; end: ${edge.toPos.x} ${edge.toPos.y} ${edge.toPos.z}; color: #64748B; opacity: 0.48`,
      );
      this.volumeGroupEl.appendChild(lineEl);
      this.edgeRefs.push({ edge, lineEl });
    }

    for (const node of this.graphController.nodes) {
      const sphereEl = document.createElement('a-sphere') as Entity;
      sphereEl.classList.add('interactable');
      sphereEl.setAttribute('radius', '0.022');
      sphereEl.setAttribute('position', `${node.x} ${node.y} ${node.z}`);
      sphereEl.setAttribute(
        'material',
        'shader: flat; color: #0284C7; opacity: 0.94; transparent: true',
      );
      sphereEl.setAttribute('data-concept-id', node.conceptId);

      sphereEl.addEventListener('click', (event: Event) => {
        event.stopPropagation();
        this.selectConcept(node.conceptId, true);
      });

      const shortLabel =
        node.label.length > 22 ? `${node.label.slice(0, 20).trimEnd()}..` : node.label;
      const labelEl = createTroikaLabel(
        shortLabel,
        `${node.x} ${node.y + 0.028} ${node.z + 0.008}`,
        '#F5F3EB',
      );

      this.volumeGroupEl.appendChild(sphereEl);
      this.volumeGroupEl.appendChild(labelEl);
      this.nodeRefs.push({ node, sphereEl, labelEl });
    }
  }
}

AFRAME.registerComponent<ConceptGraphComponent>('imx-concept-graph', {
  dependencies: ['imx-panel'],
  schema: {
    assetId: { type: 'string', default: '' },
    sourceTitle: { type: 'string', default: 'Material de estudo' },
  },
  init() {
    this.controller = new ConceptGraphBridge(this.el, this.data);
  },
  update() {
    this.controller?.updateData(this.data);
  },
  remove() {
    this.controller?.dispose();
  },
});
