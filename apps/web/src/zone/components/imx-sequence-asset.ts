import AFRAME, { type Component, type Entity } from 'aframe';

import type { SequenceOrderAsset } from '../../shared/types/study-pack';
import { formatCardCitation } from './imx-card-panel';
import {
  SequenceOrderController,
  type SequenceCheckResult,
} from '../systems/learning-assets-controller';

export const SEQUENCE_ASSET_CHECK_EVENT = 'imx-sequence-check';

export interface SequenceAssetCheckDetail {
  readonly assetId: string;
  readonly isCorrect: boolean;
  readonly correctSlotsCount: number;
  readonly totalSteps: number;
  readonly attempts: number;
}

export interface SequenceAssetData {
  assetId: string;
  sourceTitle: string;
}

export interface SequenceAssetComponent extends Component<SequenceAssetData> {
  controller?: SequenceAssetBridge;
}

function createSlotTroikaText(options: {
  position: string;
  value: string;
  color: string;
  fontSize: number;
  maxWidth: number;
}): Entity {
  const el = document.createElement('a-troika-text') as Entity;
  el.setAttribute('position', options.position);
  el.setAttribute('value', options.value);
  el.setAttribute('color', options.color);
  el.setAttribute('align', 'center');
  el.setAttribute('anchor', 'center');
  el.setAttribute('baseline', 'center');
  el.setAttribute('font-size', String(options.fontSize));
  el.setAttribute('fontSize', String(options.fontSize));
  el.setAttribute('max-width', String(options.maxWidth));
  el.setAttribute('maxWidth', String(options.maxWidth));
  el.setAttribute('line-height', '1.2');
  el.setAttribute(
    'troika-text',
    `value: ${options.value}; color: ${options.color}; fontSize: ${options.fontSize}; maxWidth: ${options.maxWidth}; lineHeight: 1.2; align: center; anchor: center; baseline: center`,
  );
  return el;
}

// componente 3d de ordenação de sequência com slots numerados, troca por pinça e verificação fundamentada (seção 3.6.3)
export class SequenceAssetBridge {
  private seqController: SequenceOrderController | null = null;
  private readonly rootGroupEl: Entity;

  constructor(
    private readonly el: Entity,
    private data: SequenceAssetData,
  ) {
    this.rootGroupEl = document.createElement('a-entity') as Entity;
    this.rootGroupEl.setAttribute('position', '0 0 0.014');
    this.el.appendChild(this.rootGroupEl);
  }

  updateData(nextData: SequenceAssetData): void {
    this.data = nextData;
  }

  setSequenceAsset(asset: SequenceOrderAsset): void {
    this.seqController = new SequenceOrderController(asset);
    this.el.setAttribute('imx-panel', {
      width: 0.78,
      height: 0.56,
      title: asset.title,
      body: '',
      footer: 'Selecione dois passos com pinça para trocar a posição nos slots.',
      accentColor: '#0284C7',
    });
    this.renderSlots();
  }

  checkCurrentOrder(): SequenceCheckResult | null {
    if (!this.seqController) return null;
    const result = this.seqController.checkOrder();
    this.renderSlots();

    const firstAnchorPage = result.anchors[0]?.page ?? 1;
    const citation = formatCardCitation(
      this.data.sourceTitle || 'Material de estudo',
      firstAnchorPage,
    );
    const statusText = result.isCorrect
      ? `Sequência correta (${result.correctSlotsCount}/${result.totalSteps}) | ${citation}`
      : `${result.correctSlotsCount}/${result.totalSteps} na posição certa (tentativa #${result.attempts}) | ${citation}`;
    this.el.setAttribute('imx-panel', 'footer', statusText);

    const detail: SequenceAssetCheckDetail = {
      assetId: this.data.assetId || this.seqController.asset.id,
      isCorrect: result.isCorrect,
      correctSlotsCount: result.correctSlotsCount,
      totalSteps: result.totalSteps,
      attempts: result.attempts,
    };
    this.el.sceneEl?.emit(SEQUENCE_ASSET_CHECK_EVENT, detail);
    return result;
  }

  dispose(): void {
    this.rootGroupEl.remove();
  }

  private renderSlots(): void {
    while (this.rootGroupEl.firstChild) {
      this.rootGroupEl.removeChild(this.rootGroupEl.firstChild);
    }
    if (!this.seqController) return;

    const slots = this.seqController.getSlots();
    const activeIdx = this.seqController.getActiveSlotIndex();
    const lastResult = this.seqController.getLastResult();
    const targetSteps = this.seqController.targetSteps;

    const total = slots.length;
    const slotW = 0.68;
    const slotH = Math.min(0.068, 0.3 / Math.max(1, total));
    const gapY = slotH + 0.012;
    const topStartY = 0.13;

    slots.forEach((step, idx) => {
      const y = topStartY - idx * gapY;
      const isSelected = activeIdx === idx;
      const isRightSlot = lastResult ? step.id === targetSteps[idx]?.id : null;

      let borderColor = '#2E323B';
      if (isSelected) {
        borderColor = '#EA580C';
      } else if (isRightSlot === true) {
        borderColor = '#10B981';
      } else if (isRightSlot === false) {
        borderColor = '#EF4444';
      }

      const borderEl = document.createElement('a-plane') as Entity;
      borderEl.setAttribute('width', String(slotW + 0.006));
      borderEl.setAttribute('height', String(slotH + 0.006));
      borderEl.setAttribute('position', `0 ${y} 0`);
      borderEl.setAttribute(
        'material',
        `shader: flat; color: ${borderColor}; opacity: 0.96; transparent: true`,
      );
      this.rootGroupEl.appendChild(borderEl);

      const btnEl = document.createElement('a-plane') as Entity;
      btnEl.classList.add('interactable');
      btnEl.setAttribute('width', String(slotW));
      btnEl.setAttribute('height', String(slotH));
      btnEl.setAttribute('position', `0 ${y} 0.002`);
      btnEl.setAttribute(
        'material',
        `shader: flat; color: ${isSelected ? '#1E3A8A' : '#18181B'}; opacity: 0.96; transparent: true`,
      );
      btnEl.setAttribute('data-slot-index', String(idx));
      btnEl.addEventListener('click', (event: Event) => {
        event.stopPropagation();
        this.seqController?.interactWithSlot(idx);
        this.renderSlots();
      });

      const shortStep = step.text.length > 64 ? `${step.text.slice(0, 61)}...` : step.text;
      const labelEl = createSlotTroikaText({
        position: '0 0 0.004',
        value: `Slot ${idx + 1}: ${shortStep}`,
        color: '#F5F3EB',
        fontSize: 0.015,
        maxWidth: slotW - 0.03,
      });
      btnEl.appendChild(labelEl);
      this.rootGroupEl.appendChild(btnEl);
    });

    // botões de ação na base: Verificar ordem e Embaralhar
    const actionY = -0.175;
    const checkBtn = document.createElement('a-plane') as Entity;
    checkBtn.classList.add('interactable');
    checkBtn.setAttribute('width', '0.28');
    checkBtn.setAttribute('height', '0.048');
    checkBtn.setAttribute('position', `-0.16 ${actionY} 0.004`);
    checkBtn.setAttribute(
      'material',
      'shader: flat; color: #EA580C; opacity: 0.96; transparent: true',
    );
    checkBtn.addEventListener('click', (event: Event) => {
      event.stopPropagation();
      this.checkCurrentOrder();
    });
    checkBtn.appendChild(
      createSlotTroikaText({
        position: '0 0 0.004',
        value: 'Verificar ordem',
        color: '#121316',
        fontSize: 0.015,
        maxWidth: 0.25,
      }),
    );
    this.rootGroupEl.appendChild(checkBtn);

    const resetBtn = document.createElement('a-plane') as Entity;
    resetBtn.classList.add('interactable');
    resetBtn.setAttribute('width', '0.24');
    resetBtn.setAttribute('height', '0.048');
    resetBtn.setAttribute('position', `0.16 ${actionY} 0.004`);
    resetBtn.setAttribute(
      'material',
      'shader: flat; color: #1F2025; opacity: 0.96; transparent: true',
    );
    resetBtn.addEventListener('click', (event: Event) => {
      event.stopPropagation();
      this.seqController?.resetShuffle();
      this.el.setAttribute(
        'imx-panel',
        'footer',
        'Passos embaralhados novamente. Selecione dois slots para trocar.',
      );
      this.renderSlots();
    });
    resetBtn.appendChild(
      createSlotTroikaText({
        position: '0 0 0.004',
        value: 'Embaralhar',
        color: '#F5F3EB',
        fontSize: 0.015,
        maxWidth: 0.21,
      }),
    );
    this.rootGroupEl.appendChild(resetBtn);
  }
}

AFRAME.registerComponent<SequenceAssetComponent>('imx-sequence-asset', {
  dependencies: ['imx-panel'],
  schema: {
    assetId: { type: 'string', default: '' },
    sourceTitle: { type: 'string', default: 'Material de estudo' },
  },
  init() {
    this.controller = new SequenceAssetBridge(this.el, this.data);
  },
  update() {
    this.controller?.updateData(this.data);
  },
  remove() {
    this.controller?.dispose();
  },
});
