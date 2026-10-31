import AFRAME, { type Component, type Entity } from 'aframe';
import type { RotatableComponent } from 'interacxr';
import type {
  BufferGeometry,
  Line,
  LineDashedMaterial,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

import type {
  ConceptEdge,
  ConceptGraphAsset,
  ConceptNode,
  StudyCard,
} from '../../shared/types/study-pack';
import type { ZoneTheme } from '../config/constants';
import {
  ConceptGraphController,
  type NodeRelationItem,
  type ScaledGraphEdge,
  type ScaledGraphNode,
} from '../systems/learning-assets-controller';
import {
  resolveInitialTheme,
  ZONE_THEME_CHANGE_EVENT,
  ZONE_THEME_STORAGE_KEY,
} from '../systems/theme-controller';
import { formatCardCitation } from './imx-card-panel';

export const CONCEPT_GRAPH_NODE_SELECT_EVENT = 'imx-concept-graph-select';

export interface ConceptGraphNodeSelectDetail {
  readonly assetId: string;
  readonly conceptId: string;
  readonly label: string;
  readonly definition: string;
  readonly sourcePage: number;
  readonly sourceTitle: string;
  readonly parents: readonly NodeRelationItem[];
  readonly children: readonly NodeRelationItem[];
  readonly card: StudyCard;
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
  readonly sphereMesh: Mesh<SphereGeometry> | null;
  readonly labelEl: Entity;
  readonly outlineLine: Line;
  readonly outlineMaterial: LineDashedMaterial;
  currentOutlineScale: number;
  targetOutlineScale: number;
  isHovered: boolean;
}

interface EdgeEntityRefs {
  readonly edge: ScaledGraphEdge;
  readonly solidLineEl: Entity;
  readonly dashedLine: Line;
  readonly dashedMaterial: ShaderMaterial;
}

function createDashedCircleGeometry(radius: number, segments = 48): BufferGeometry {
  const points: Vector3[] = [];
  const THREE = AFRAME.THREE;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(theta) * radius, Math.sin(theta) * radius, 0));
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

function createDirectionalFlowMaterial(colorHex: number): ShaderMaterial {
  const THREE = AFRAME.THREE;
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(colorHex) },
      dashOffset: { value: 0 },
      dashSize: { value: 0.016 },
      gapSize: { value: 0.01 },
      opacity: { value: 1.0 },
    },
    vertexShader: `
      attribute float lineDistance;
      varying float vDistance;
      void main() {
        vDistance = lineDistance;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float dashOffset;
      uniform float dashSize;
      uniform float gapSize;
      uniform float opacity;
      varying float vDistance;
      void main() {
        float total = dashSize + gapSize;
        if (mod(vDistance + dashOffset, total) > dashSize) {
          discard;
        }
        gl_FragColor = vec4(color, opacity);
      }
    `,
    transparent: true,
    depthTest: false,
  });
}

function createTroikaLabel(text: string, position: string, color: string): Entity {
  const el = document.createElement('a-troika-text') as Entity;
  el.setAttribute('position', position);
  el.setAttribute('value', text);
  el.setAttribute('color', color);
  el.setAttribute('align', 'center');
  el.setAttribute('anchor', 'center');
  el.setAttribute('baseline', 'bottom');
  el.setAttribute('font-size', '0.03');
  el.setAttribute('fontSize', '0.03');
  el.setAttribute('max-width', '0.36');
  el.setAttribute('maxWidth', '0.36');
  el.setAttribute('outline-width', '0.003');
  el.setAttribute('outline-color', '#000000');
  el.setAttribute('outline-opacity', '1');
  el.setAttribute(
    'troika-text',
    `value: ${text}; color: ${color}; fontSize: 0.03; maxWidth: 0.36; align: center; anchor: center; baseline: bottom; outlineWidth: 0.003; outlineColor: #000000; outlineOpacity: 1`,
  );
  return el;
}

// interpola paleta em escala de cinza até azul escuro no tema claro com base na profundidade da árvore
function computeNodeColor(depth: number, maxDepth: number, theme: ZoneTheme): string {
  const normalizedDepth = Math.max(0, Math.min(1, maxDepth > 0 ? depth / maxDepth : 0));

  if (theme === 'light-glass') {
    // profundidade 0 (raiz): branco (#ffffff); gradualmente escurece em direção a azul escuro (#1e293b)
    const r = Math.round(255 - normalizedDepth * (255 - 30));
    const g = Math.round(255 - normalizedDepth * (255 - 41));
    const b = Math.round(255 - normalizedDepth * (255 - 59));
    return `rgb(${r}, ${g}, ${b})`;
  }

  // tema escuro: base azul ardósia escuro (slate tones)
  const r = Math.round(51 - normalizedDepth * (51 - 15));
  const g = Math.round(65 - normalizedDepth * (65 - 23));
  const b = Math.round(85 - normalizedDepth * (85 - 42));
  return `rgb(${r}, ${g}, ${b})`;
}

// componente espacial do grafo 3d com shaders adaptativos por profundidade, contorno tracejado, isolamento visual e billboard
export class ConceptGraphBridge {
  private graphController: ConceptGraphController | null = null;
  private readonly volumeGroupEl: Entity;
  private readonly hitVolumeEl: Entity;
  private readonly nodeRefs: NodeEntityRefs[] = [];
  private readonly edgeRefs: EdgeEntityRefs[] = [];
  private currentScale = 1.0;
  private baseHeight = 0.56;
  private currentTheme: ZoneTheme;
  private selectedNodeId: string | null = null;
  private activeNeighborIds = new Set<string>();

  private readonly tmpCamQuat = new AFRAME.THREE.Quaternion();
  private readonly tmpParentQuat = new AFRAME.THREE.Quaternion();
  private readonly tmpBillboardQuat = new AFRAME.THREE.Quaternion();

  private readonly onThemeChange = (event: Event): void => {
    const detail = (event as CustomEvent<{ theme: ZoneTheme }>).detail;
    if (detail?.theme) {
      this.currentTheme = detail.theme;
      this.applyThemeAndStyles();
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    const rotatable = this.rotatableController();
    if (!rotatable?.getRotationState().isHovered) return;
    if (Math.abs(event.deltaY) < 4) return;
    this.adjustScale(event.deltaY < 0 ? 1 : -1);
  };

  constructor(
    private readonly el: Entity,
    private data: ConceptGraphData,
  ) {
    let storedPref: string | null = null;
    try {
      storedPref = localStorage.getItem(ZONE_THEME_STORAGE_KEY);
    } catch {
      // ignora caso localStorage não esteja acessível
    }
    this.currentTheme = resolveInitialTheme(storedPref);

    this.el.classList.add('rotatable');
    this.el.setAttribute('data-rotatable', 'true');

    this.volumeGroupEl = document.createElement('a-entity') as Entity;
    this.volumeGroupEl.setAttribute('data-rotatable-volume', 'true');
    this.volumeGroupEl.setAttribute('position', '0 0.02 0.06');
    this.el.appendChild(this.volumeGroupEl);

    this.hitVolumeEl = document.createElement('a-entity') as Entity;
    this.hitVolumeEl.setAttribute('data-hit-volume', 'true');
    this.hitVolumeEl.setAttribute('data-ixr-ignore-rotate', 'true');
    this.hitVolumeEl.setAttribute(
      'geometry',
      'primitive: box; width: 0.84; height: 0.56; depth: 0.36',
    );
    // volume de baixa prioridade para o cursor: habilita o foco de rotação no espaço vazio do grafo
    // sem nunca bloquear nós ou botões da alça (o cursor prefere alvos concretos da mesma raiz)
    this.hitVolumeEl.setAttribute('material', 'visible: false');
    this.volumeGroupEl.appendChild(this.hitVolumeEl);

    this.el.setAttribute(
      'ixr-rotatable',
      'targetSelector: [data-rotatable-volume]; fadeOutDelayMs: 2000; easing: 0.16; rotationSpeed: 3.2; boxOpacity: 0.65; boxPadding: 0.024',
    );

    window.addEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
    if (typeof window !== 'undefined') {
      window.addEventListener('wheel', this.onWheel, { passive: true });
    }
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
    this.selectedNodeId = null;
    this.activeNeighborIds.clear();
    this.rebuildVolumeDom();
    this.applyThemeAndStyles();
  }

  tick(_time: number, timeDelta: number): void {
    const deltaSec = Math.min(0.1, (timeDelta || 16.6) / 1000);

    // rotação billboard para que os rótulos de texto e contornos nunca fiquem de ponta-cabeça
    const cam = this.el.sceneEl?.camera;
    if (cam) {
      cam.getWorldQuaternion(this.tmpCamQuat);
      this.volumeGroupEl.object3D.getWorldQuaternion(this.tmpParentQuat);
      this.tmpParentQuat.invert();
      this.tmpBillboardQuat.multiplyQuaternions(this.tmpParentQuat, this.tmpCamQuat);

      for (const ref of this.nodeRefs) {
        ref.labelEl.object3D.quaternion.copy(this.tmpBillboardQuat);
        ref.outlineLine.quaternion.copy(this.tmpBillboardQuat);
      }
    }

    // animação da espessura/escala do contorno em resposta ao foco do raycast
    for (const ref of this.nodeRefs) {
      const diff = ref.targetOutlineScale - ref.currentOutlineScale;
      if (Math.abs(diff) > 0.005) {
        ref.currentOutlineScale += diff * 0.25;
        ref.outlineLine.scale.setScalar(ref.currentOutlineScale);
      }
    }

    // animação contínua das arestas ativas com fluxo direcionado (de sourceId para targetId)
    for (const edgeRef of this.edgeRefs) {
      if (edgeRef.dashedLine.visible) {
        const uniforms = edgeRef.dashedMaterial.uniforms;
        if (uniforms?.dashOffset) {
          uniforms.dashOffset.value -= deltaSec * 0.045;
        }
      }
    }
  }

  selectConcept(conceptId: string, emitEvent = true): void {
    if (!this.graphController) return;
    if (this.selectedNodeId === conceptId) {
      this.deselectConcept();
      return;
    }
    const selection = this.graphController.selectNode(conceptId);
    if (!selection) return;

    this.selectedNodeId = conceptId;
    this.activeNeighborIds.clear();
    for (const p of selection.parents) {
      this.activeNeighborIds.add(p.conceptId);
    }
    for (const c of selection.children) {
      this.activeNeighborIds.add(c.conceptId);
    }

    this.applyThemeAndStyles();

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
        label: selection.node.label,
        definition: selection.node.definition,
        sourcePage: page,
        sourceTitle: this.data.sourceTitle || 'Material de estudo',
        parents: selection.parents,
        children: selection.children,
        card: selection.card,
      };
      this.el.sceneEl?.emit(CONCEPT_GRAPH_NODE_SELECT_EVENT, detail);
    }
  }

  deselectConcept(): void {
    if (!this.graphController) return;
    this.graphController.clearSelection();
    this.selectedNodeId = null;
    this.activeNeighborIds.clear();
    this.applyThemeAndStyles();
    this.el.setAttribute('imx-panel', 'title', this.graphController.asset.title);
    this.el.setAttribute('imx-panel', 'body', '');
    this.el.setAttribute('imx-panel', 'footer', '');
  }

  adjustScale(direction: 1 | -1): void {
    const nextScale = Math.max(
      0.4,
      Math.min(2.5, Math.round((this.currentScale + direction * 0.15) * 100) / 100),
    );
    if (nextScale === this.currentScale) return;
    this.currentScale = nextScale;
    this.volumeGroupEl.object3D.scale.set(nextScale, nextScale, nextScale);

    const effectiveHeight = this.baseHeight * nextScale;
    this.el.setAttribute('imx-panel', 'height', effectiveHeight);
    this.el.setAttribute('imx-drag-handle', { height: effectiveHeight });
    this.rotatableController()?.recalculateBounds();
  }

  dispose(): void {
    window.removeEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
    if (typeof window !== 'undefined') {
      window.removeEventListener('wheel', this.onWheel);
    }
    for (const ref of this.nodeRefs) {
      ref.outlineLine.geometry.dispose();
      ref.outlineMaterial.dispose();
      ref.outlineLine.removeFromParent();
    }
    for (const edgeRef of this.edgeRefs) {
      edgeRef.dashedLine.geometry.dispose();
      edgeRef.dashedMaterial.dispose();
      edgeRef.dashedLine.removeFromParent();
    }
    this.nodeRefs.length = 0;
    this.edgeRefs.length = 0;
    this.volumeGroupEl.remove();
  }

  private rotatableController() {
    const comp = this.el.components['ixr-rotatable'] as RotatableComponent | undefined;
    return comp?.controller ?? null;
  }

  private applyThemeAndStyles(): void {
    if (!this.graphController) return;
    const isLight = this.currentTheme === 'light-glass';
    const maxDepth = Math.max(...this.graphController.nodes.map((n) => n.depth), 1);
    const outlineColor = isLight ? 0x18181b : 0xffffff;

    for (const ref of this.nodeRefs) {
      const isSelected = ref.node.conceptId === this.selectedNodeId;
      const isNeighbor = this.activeNeighborIds.has(ref.node.conceptId);
      const isActive = this.selectedNodeId === null || isSelected || isNeighbor;

      const baseNodeColor = computeNodeColor(ref.node.depth, maxDepth, this.currentTheme);
      // no estado selecionado, destaca os nós ativos preservando a elegância do tema sem cores berrantes
      const nodeColor = isSelected
        ? isLight
          ? '#0284C7'
          : '#38BDF8'
        : isNeighbor
          ? isLight
            ? '#38BDF8'
            : '#0284C7'
          : baseNodeColor;

      const opacity = isActive ? 1.0 : 0.15;
      const scale = isSelected ? 1.35 : isNeighbor ? 1.15 : isActive ? 1.0 : 0.85;

      ref.sphereEl.setAttribute('scale', `${scale} ${scale} ${scale}`);
      ref.sphereEl.setAttribute(
        'material',
        `shader: flat; color: ${nodeColor}; opacity: ${opacity}; transparent: true`,
      );

      // o rótulo flutua sobre o ambiente (céu), não sobre um painel do tema: usa sempre texto claro
      // com contorno escuro para garantir contraste em qualquer combinação de tema e ambiente
      const labelColor = isSelected ? '#7DD3FC' : '#F8FAFC';

      ref.labelEl.setAttribute('color', labelColor);
      ref.labelEl.setAttribute('troika-text', 'color', labelColor);
      ref.labelEl.setAttribute('troika-text', 'fillOpacity', opacity);
      ref.labelEl.setAttribute('troika-text', 'outlineOpacity', opacity);

      ref.outlineMaterial.color.setHex(outlineColor);
      ref.outlineMaterial.opacity = isSelected ? 1.0 : isNeighbor ? 0.85 : opacity * 0.75;
      if (!ref.isHovered) {
        ref.targetOutlineScale = isSelected ? 1.38 : isNeighbor ? 1.15 : 1.0;
      }
    }

    for (const edgeRef of this.edgeRefs) {
      const isConnected =
        this.selectedNodeId !== null &&
        (edgeRef.edge.fromId === this.selectedNodeId || edgeRef.edge.toId === this.selectedNodeId);

      if (this.selectedNodeId === null) {
        // sem seleção: arestas visíveis normais
        edgeRef.solidLineEl.setAttribute('visible', 'true');
        edgeRef.solidLineEl.setAttribute('line', 'opacity', 0.45);
        edgeRef.dashedLine.visible = false;
      } else if (isConnected) {
        // aresta conectada: ativa fluxo tracejado direcionado
        edgeRef.solidLineEl.setAttribute('visible', 'false');
        edgeRef.dashedLine.visible = true;
        const uniforms = edgeRef.dashedMaterial.uniforms;
        if (uniforms?.opacity) {
          uniforms.opacity.value = 1.0;
        }
        if (uniforms?.color) {
          uniforms.color.value.setHex(isLight ? 0x0284c7 : 0x38bdf8);
        }
      } else {
        // aresta não conectada: cai para 15% de opacidade
        edgeRef.dashedLine.visible = false;
        edgeRef.solidLineEl.setAttribute('visible', 'true');
        edgeRef.solidLineEl.setAttribute('line', 'opacity', 0.12);
      }
    }
  }

  private rebuildVolumeDom(): void {
    for (const ref of this.nodeRefs) {
      ref.outlineLine.geometry.dispose();
      ref.outlineMaterial.dispose();
      ref.outlineLine.removeFromParent();
    }
    for (const edgeRef of this.edgeRefs) {
      edgeRef.dashedLine.geometry.dispose();
      edgeRef.dashedMaterial.dispose();
      edgeRef.dashedLine.removeFromParent();
    }
    this.nodeRefs.length = 0;
    this.edgeRefs.length = 0;

    const children = [...this.volumeGroupEl.children];
    for (const child of children) {
      if (child !== this.hitVolumeEl) {
        this.volumeGroupEl.removeChild(child);
      }
    }
    if (!this.graphController) return;

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    const isLight = this.currentTheme === 'light-glass';
    const outlineHex = isLight ? 0x18181b : 0xffffff;

    // cria arestas (linha sólida base + linha tracejada animada para o estado ativo)
    for (const edge of this.graphController.edges) {
      const solidLineEl = document.createElement('a-entity') as Entity;
      solidLineEl.setAttribute(
        'line',
        `start: ${edge.fromPos.x} ${edge.fromPos.y} ${edge.fromPos.z}; end: ${edge.toPos.x} ${edge.toPos.y} ${edge.toPos.z}; color: #64748B; opacity: 0.45`,
      );
      this.volumeGroupEl.appendChild(solidLineEl);

      const THREE = AFRAME.THREE;
      const dashedGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(edge.fromPos.x, edge.fromPos.y, edge.fromPos.z),
        new THREE.Vector3(edge.toPos.x, edge.toPos.y, edge.toPos.z),
      ]);
      const dashedMat = createDirectionalFlowMaterial(0x38bdf8);
      const dashedLine = new THREE.Line(dashedGeom, dashedMat);
      dashedLine.computeLineDistances();
      dashedLine.visible = false;
      dashedLine.renderOrder = 92;
      this.volumeGroupEl.object3D.add(dashedLine);

      this.edgeRefs.push({
        edge,
        solidLineEl,
        dashedLine,
        dashedMaterial: dashedMat,
      });
    }

    const sphereRadius = 0.032;
    for (const node of this.graphController.nodes) {
      minX = Math.min(minX, node.x - sphereRadius);
      maxX = Math.max(maxX, node.x + sphereRadius);
      minY = Math.min(minY, node.y - sphereRadius);
      maxY = Math.max(maxY, node.y + sphereRadius);
      minZ = Math.min(minZ, node.z - sphereRadius);
      maxZ = Math.max(maxZ, node.z + sphereRadius);

      const sphereEl = document.createElement('a-sphere') as Entity;
      sphereEl.classList.add('interactable');
      sphereEl.setAttribute('radius', String(sphereRadius));
      sphereEl.setAttribute('position', `${node.x} ${node.y} ${node.z}`);
      sphereEl.setAttribute(
        'material',
        'shader: flat; color: #FFFFFF; opacity: 1.0; transparent: true',
      );
      sphereEl.setAttribute('data-concept-id', node.conceptId);

      // contorno tracejado concêntrico ao redor da esfera
      const outlineGeom = createDashedCircleGeometry(sphereRadius * 1.3, 48);
      const outlineMaterial = new AFRAME.THREE.LineDashedMaterial({
        color: outlineHex,
        dashSize: 0.006,
        gapSize: 0.004,
        transparent: true,
        opacity: 0.9,
        depthTest: true,
      });
      const outlineLine = new AFRAME.THREE.Line(outlineGeom, outlineMaterial);
      outlineLine.computeLineDistances();
      outlineLine.renderOrder = 95;
      outlineLine.position.set(node.x, node.y, node.z);
      this.volumeGroupEl.object3D.add(outlineLine);

      const ref: NodeEntityRefs = {
        node,
        sphereEl,
        sphereMesh: null,
        labelEl: null as unknown as Entity,
        outlineLine,
        outlineMaterial,
        currentOutlineScale: 1.0,
        targetOutlineScale: 1.0,
        isHovered: false,
      };

      // ampliação dinâmica do contorno ao passar o raio/cursor (indicação de affordance de clique)
      sphereEl.addEventListener('mouseenter', () => {
        ref.isHovered = true;
        ref.targetOutlineScale = 1.38;
        ref.outlineMaterial.opacity = 1.0;
      });

      sphereEl.addEventListener('mouseleave', () => {
        ref.isHovered = false;
        const isSelected = ref.node.conceptId === this.selectedNodeId;
        const isNeighbor = this.activeNeighborIds.has(ref.node.conceptId);
        const isActive = this.selectedNodeId === null || isSelected || isNeighbor;
        ref.targetOutlineScale = isSelected ? 1.38 : isNeighbor ? 1.15 : isActive ? 1.0 : 0.85;
        ref.outlineMaterial.opacity = isActive ? 1.0 : 0.15;
      });

      sphereEl.addEventListener('click', (event: Event) => {
        event.stopPropagation();
        this.selectConcept(node.conceptId, true);
      });

      const shortLabel =
        node.label.length > 26 ? `${node.label.slice(0, 24).trimEnd()}..` : node.label;
      const labelEl = createTroikaLabel(
        shortLabel,
        `${node.x} ${node.y + 0.048} ${node.z + 0.012}`,
        '#F5F3EB',
      );
      (ref as { labelEl: Entity }).labelEl = labelEl;

      this.volumeGroupEl.appendChild(sphereEl);
      this.volumeGroupEl.appendChild(labelEl);
      this.nodeRefs.push(ref);
    }

    const pad = 0.048;
    const hitW = Number.isFinite(minX) ? Math.max(0.24, maxX - minX + pad) : 0.84;
    const hitH = Number.isFinite(minY) ? Math.max(0.24, maxY - minY + pad) : 0.56;
    const hitD = Number.isFinite(minZ) ? Math.max(0.18, maxZ - minZ + pad) : 0.36;
    const cx = Number.isFinite(minX) ? (minX + maxX) / 2 : 0;
    const cy = Number.isFinite(minY) ? (minY + maxY) / 2 : 0;
    const cz = Number.isFinite(minZ) ? (minZ + maxZ) / 2 : 0;

    this.baseHeight = hitH;
    this.hitVolumeEl.setAttribute('position', `${cx} ${cy} ${cz}`);
    this.hitVolumeEl.setAttribute(
      'geometry',
      `primitive: box; width: ${hitW}; height: ${hitH}; depth: ${hitD}`,
    );

    this.el.setAttribute('imx-panel', {
      width: hitW,
      height: hitH * this.currentScale,
      accentColor: '#0284C7',
      frameless: true,
      body: '',
    });

    this.rotatableController()?.recalculateBounds();
    this.applyThemeAndStyles();
  }
}

AFRAME.registerComponent<ConceptGraphComponent>('imx-concept-graph', {
  dependencies: ['imx-panel', 'ixr-rotatable'],
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
  tick(time, timeDelta) {
    this.controller?.tick(time, timeDelta);
  },
  remove() {
    this.controller?.dispose();
  },
});
