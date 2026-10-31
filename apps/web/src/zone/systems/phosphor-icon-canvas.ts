import AFRAME, { type Entity } from 'aframe';
import type { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

export type PhosphorVrIconName =
  | 'sign-out'
  | 'squares-four'
  | 'crosshair'
  | 'stack'
  | 'timer'
  | 'goggles'
  | 'sun-dim'
  | 'moon'
  | 'hand'
  | 'file-pdf'
  | 'cards'
  | 'brain'
  | 'exam'
  | 'cube'
  | 'trash'
  | 'minus'
  | 'plus'
  | 'caret-left'
  | 'caret-right';

interface IconPlaneMeta {
  icon: PhosphorVrIconName;
  color: string;
  canvas: HTMLCanvasElement;
  texture: CanvasTexture | null;
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial> | null;
}

const iconRegistry = new WeakMap<Entity, IconPlaneMeta>();

// desenha o glifo vetorial correspondente ao ícone phosphor em um canvas 2d de 128x128
export function drawPhosphorGlyph(
  ctx: CanvasRenderingContext2D,
  icon: PhosphorVrIconName,
  color: string,
): void {
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 8.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (icon) {
    case 'sign-out': {
      // moldura da porta à esquerda e seta apontando para a direita
      ctx.beginPath();
      ctx.moveTo(52, 24);
      ctx.lineTo(26, 24);
      ctx.lineTo(26, 104);
      ctx.lineTo(52, 104);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(48, 64);
      ctx.lineTo(102, 64);
      ctx.moveTo(80, 42);
      ctx.lineTo(102, 64);
      ctx.lineTo(80, 86);
      ctx.stroke();
      break;
    }
    case 'squares-four': {
      // quatro blocos modulares (zonas)
      ctx.strokeRect(24, 24, 32, 32);
      ctx.strokeRect(72, 24, 32, 32);
      ctx.strokeRect(24, 72, 32, 32);
      ctx.strokeRect(72, 72, 32, 32);
      break;
    }
    case 'crosshair': {
      // mira de recentralização
      ctx.beginPath();
      ctx.arc(64, 64, 32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(64, 16);
      ctx.lineTo(64, 36);
      ctx.moveTo(64, 92);
      ctx.lineTo(64, 112);
      ctx.moveTo(16, 64);
      ctx.lineTo(36, 64);
      ctx.moveTo(92, 64);
      ctx.lineTo(112, 64);
      ctx.stroke();
      break;
    }
    case 'stack': {
      // camadas empilhadas (conteúdos)
      ctx.beginPath();
      ctx.moveTo(64, 22);
      ctx.lineTo(108, 44);
      ctx.lineTo(64, 66);
      ctx.lineTo(20, 44);
      ctx.closePath();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(20, 64);
      ctx.lineTo(64, 86);
      ctx.lineTo(108, 64);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(20, 84);
      ctx.lineTo(64, 106);
      ctx.lineTo(108, 84);
      ctx.stroke();
      break;
    }
    case 'timer': {
      // cronômetro pomodoro
      ctx.beginPath();
      ctx.arc(64, 68, 36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(50, 20);
      ctx.lineTo(78, 20);
      ctx.moveTo(64, 20);
      ctx.lineTo(64, 32);
      ctx.moveTo(64, 68);
      ctx.lineTo(82, 52);
      ctx.stroke();
      break;
    }
    case 'goggles': {
      // visor vr / modo
      ctx.beginPath();
      ctx.moveTo(20, 44);
      ctx.lineTo(108, 44);
      ctx.lineTo(108, 86);
      ctx.lineTo(76, 86);
      ctx.lineTo(64, 72);
      ctx.lineTo(52, 86);
      ctx.lineTo(20, 86);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(40, 64, 8, 0, Math.PI * 2);
      ctx.arc(88, 64, 8, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'sun-dim': {
      // sol minimalista para alternar tema
      ctx.beginPath();
      ctx.arc(64, 64, 22, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(64 + Math.cos(angle) * 34, 64 + Math.sin(angle) * 34);
        ctx.lineTo(64 + Math.cos(angle) * 44, 64 + Math.sin(angle) * 44);
        ctx.stroke();
      }
      break;
    }
    case 'moon': {
      // lua crescente minimalista estilo phosphor para alternância de tema
      ctx.beginPath();
      ctx.arc(64, 64, 36, 0.42 * Math.PI, 1.82 * Math.PI, false);
      ctx.quadraticCurveTo(46, 68, 73, 99);
      ctx.stroke();
      break;
    }
    case 'hand': {
      // mão estilizada com contorno minimalista estilo phosphor
      ctx.beginPath();
      ctx.moveTo(46, 106);
      ctx.lineTo(46, 80);
      ctx.lineTo(26, 68);
      ctx.arc(26, 60, 8, 0.5 * Math.PI, 1.5 * Math.PI, false);
      ctx.lineTo(48, 52);
      ctx.lineTo(48, 28);
      ctx.arc(54, 28, 6, Math.PI, 0, false);
      ctx.lineTo(60, 48);
      ctx.lineTo(60, 22);
      ctx.arc(66, 22, 6, Math.PI, 0, false);
      ctx.lineTo(72, 48);
      ctx.lineTo(72, 28);
      ctx.arc(78, 28, 6, Math.PI, 0, false);
      ctx.lineTo(84, 54);
      ctx.lineTo(84, 42);
      ctx.arc(90, 42, 6, Math.PI, 0, false);
      ctx.lineTo(96, 76);
      ctx.lineTo(82, 106);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'file-pdf': {
      // folha de documento com dobra superior
      ctx.beginPath();
      ctx.moveTo(32, 20);
      ctx.lineTo(76, 20);
      ctx.lineTo(96, 40);
      ctx.lineTo(96, 108);
      ctx.lineTo(32, 108);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(74, 20);
      ctx.lineTo(74, 42);
      ctx.lineTo(96, 42);
      ctx.moveTo(46, 64);
      ctx.lineTo(82, 64);
      ctx.moveTo(46, 82);
      ctx.lineTo(74, 82);
      ctx.stroke();
      break;
    }
    case 'cards': {
      // cartões sobrepostos (flashcards)
      ctx.strokeRect(24, 36, 64, 68);
      ctx.beginPath();
      ctx.moveTo(40, 24);
      ctx.lineTo(104, 24);
      ctx.lineTo(104, 92);
      ctx.stroke();
      break;
    }
    case 'brain': {
      // nó de conceito conectado
      ctx.beginPath();
      ctx.arc(64, 42, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(38, 86, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(90, 86, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(54, 55);
      ctx.lineTo(44, 73);
      ctx.moveTo(74, 55);
      ctx.lineTo(84, 73);
      ctx.moveTo(52, 86);
      ctx.lineTo(76, 86);
      ctx.stroke();
      break;
    }
    case 'exam': {
      // prancheta de quiz com marca de verificação
      ctx.strokeRect(28, 22, 72, 84);
      ctx.beginPath();
      ctx.moveTo(44, 66);
      ctx.lineTo(58, 80);
      ctx.lineTo(84, 50);
      ctx.stroke();
      break;
    }
    case 'cube': {
      // cubo isométrico 3d (objetos de estudo)
      ctx.beginPath();
      ctx.moveTo(64, 20);
      ctx.lineTo(104, 42);
      ctx.lineTo(104, 86);
      ctx.lineTo(64, 108);
      ctx.lineTo(24, 86);
      ctx.lineTo(24, 42);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(24, 42);
      ctx.lineTo(64, 64);
      ctx.lineTo(104, 42);
      ctx.moveTo(64, 64);
      ctx.lineTo(64, 108);
      ctx.stroke();
      break;
    }
    case 'trash': {
      // ícone phosphor trash (lixeira de exclusão)
      ctx.beginPath();
      ctx.moveTo(24, 36);
      ctx.lineTo(104, 36);
      ctx.moveTo(48, 36);
      ctx.lineTo(48, 22);
      ctx.lineTo(80, 22);
      ctx.lineTo(80, 36);
      ctx.moveTo(34, 36);
      ctx.lineTo(40, 104);
      ctx.lineTo(88, 104);
      ctx.lineTo(94, 36);
      ctx.moveTo(54, 54);
      ctx.lineTo(54, 86);
      ctx.moveTo(74, 54);
      ctx.lineTo(74, 86);
      ctx.stroke();
      break;
    }
    case 'minus': {
      ctx.beginPath();
      ctx.moveTo(30, 64);
      ctx.lineTo(98, 64);
      ctx.stroke();
      break;
    }
    case 'plus': {
      ctx.beginPath();
      ctx.moveTo(30, 64);
      ctx.lineTo(98, 64);
      ctx.moveTo(64, 30);
      ctx.lineTo(64, 98);
      ctx.stroke();
      break;
    }
    case 'caret-left': {
      ctx.beginPath();
      ctx.moveTo(78, 30);
      ctx.lineTo(44, 64);
      ctx.lineTo(78, 98);
      ctx.stroke();
      break;
    }
    case 'caret-right': {
      ctx.beginPath();
      ctx.moveTo(50, 30);
      ctx.lineTo(84, 64);
      ctx.lineTo(50, 98);
      ctx.stroke();
      break;
    }
  }
}

// cria uma entidade a-frame contendo um plano texturizado com o ícone phosphor solicitado
export function createPhosphorIconEntity(options: {
  icon: PhosphorVrIconName;
  color: string;
  size: number;
  position: string;
}): Entity {
  const el = document.createElement('a-entity') as Entity;
  el.setAttribute('position', options.position);
  el.setAttribute('data-phosphor-icon', options.icon);

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;

  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (ctx) {
    drawPhosphorGlyph(ctx, options.icon, options.color);
  }

  let texture: CanvasTexture | null = null;
  let mesh: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null;

  if (AFRAME?.THREE && el.object3D) {
    const THREE = AFRAME.THREE;
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    const geom = new THREE.PlaneGeometry(options.size, options.size);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 3;
    el.object3D.add(mesh);
  }

  iconRegistry.set(el, {
    icon: options.icon,
    color: options.color,
    canvas,
    texture,
    mesh,
  });

  return el;
}

// atualiza a cor, opacidade e opcionalmente o glifo de um ícone phosphor existente na cena vr
export function updatePhosphorIconAppearance(
  el: Entity,
  nextColor: string,
  nextOpacity = 1,
  nextIcon?: PhosphorVrIconName,
): void {
  const meta = iconRegistry.get(el);
  if (!meta) return;

  const iconChanged = Boolean(nextIcon && nextIcon !== meta.icon);
  const colorChanged = meta.color !== nextColor;

  if (iconChanged || colorChanged) {
    if (nextIcon) {
      meta.icon = nextIcon;
      el.setAttribute('data-phosphor-icon', nextIcon);
    }
    meta.color = nextColor;
    let ctx: CanvasRenderingContext2D | null;
    try {
      ctx = meta.canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (ctx) {
      drawPhosphorGlyph(ctx, meta.icon, nextColor);
    }
    if (meta.texture) {
      meta.texture.needsUpdate = true;
    }
  }

  if (meta.mesh) {
    meta.mesh.material.opacity = nextOpacity;
  }
}
