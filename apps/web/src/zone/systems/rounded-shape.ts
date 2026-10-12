import type { Shape, ShapeGeometry } from 'three';

export interface RoundedRectBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly clampedRadius: number;
}

// calcula os limites e o raio de curvatura limitado pelas dimensões do plano
export function computeRoundedRectBounds(
  width: number,
  height: number,
  radius: number,
): RoundedRectBounds {
  const w = Math.max(0.001, width);
  const h = Math.max(0.001, height);
  const clampedRadius = Math.max(0, Math.min(radius, w / 2, h / 2));
  return {
    minX: -w / 2,
    maxX: w / 2,
    minY: -h / 2,
    maxY: h / 2,
    clampedRadius,
  };
}

function getThree(): typeof import('three') | null {
  if (typeof window !== 'undefined') {
    const aframe = (window as unknown as { AFRAME?: { THREE: typeof import('three') } }).AFRAME;
    if (aframe?.THREE) return aframe.THREE;
  }
  return null;
}

// cria uma forma bidimensional de retângulo com cantos arredondados suaves
export function createRoundedRectShape(
  width: number,
  height: number,
  radius: number,
): Shape | null {
  const THREE = getThree();
  if (!THREE) return null;
  const {
    minX,
    maxX,
    minY,
    maxY,
    clampedRadius: r,
  } = computeRoundedRectBounds(width, height, radius);
  const shape = new THREE.Shape();

  if (r <= 0.0001) {
    shape.moveTo(minX, minY);
    shape.lineTo(maxX, minY);
    shape.lineTo(maxX, maxY);
    shape.lineTo(minX, maxY);
    shape.closePath();
    return shape;
  }

  shape.moveTo(minX + r, minY);
  shape.lineTo(maxX - r, minY);
  shape.quadraticCurveTo(maxX, minY, maxX, minY + r);
  shape.lineTo(maxX, maxY - r);
  shape.quadraticCurveTo(maxX, maxY, maxX - r, maxY);
  shape.lineTo(minX + r, maxY);
  shape.quadraticCurveTo(minX, maxY, minX, maxY - r);
  shape.lineTo(minX, minY + r);
  shape.quadraticCurveTo(minX, minY, minX + r, minY);
  shape.closePath();

  return shape;
}

// instancia a geometria tridimensional do retângulo arredondado com os segmentos de arco
export function createRoundedRectGeometry(
  width: number,
  height: number,
  radius: number,
  segments = 8,
): ShapeGeometry | null {
  const THREE = getThree();
  if (!THREE) return null;
  const shape = createRoundedRectShape(width, height, radius);
  if (!shape) return null;
  return new THREE.ShapeGeometry(shape, Math.max(2, segments));
}

interface AframeGeometryContext {
  geometry?: ShapeGeometry;
}

interface AframeGeometryHost {
  registerGeometry?: (
    name: string,
    definition: {
      schema: Record<string, unknown>;
      init: (
        this: AframeGeometryContext,
        data: { width: number; height: number; radius: number; segments: number },
      ) => void;
    },
  ) => void;
}

let geometryRegistered = false;

// registra a primitiva de geometria rounded-rect no a-frame se ainda não tiver sido registrada
export function registerRoundedRectGeometry(): void {
  if (geometryRegistered) return;
  if (typeof window === 'undefined') return;
  const aframe = (window as unknown as { AFRAME?: AframeGeometryHost }).AFRAME;
  if (!aframe || typeof aframe.registerGeometry !== 'function') return;

  try {
    aframe.registerGeometry('rounded-rect', {
      schema: {
        width: { type: 'number', default: 1 },
        height: { type: 'number', default: 1 },
        radius: { type: 'number', default: 0.02 },
        segments: { type: 'int', default: 8 },
      },
      init(data: { width: number; height: number; radius: number; segments: number }) {
        const geo = createRoundedRectGeometry(data.width, data.height, data.radius, data.segments);
        if (geo) {
          this.geometry = geo;
        }
      },
    });
    geometryRegistered = true;
  } catch {
    // ignora caso já esteja registrado no ciclo do a-frame
  }
}

// auto-registra ao importar o módulo no navegador
registerRoundedRectGeometry();
