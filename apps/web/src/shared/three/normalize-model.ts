import type AFRAME from 'aframe';
import type { AnimationMixer, Object3D, SkinnedMesh } from 'three';

type ThreeLib = typeof AFRAME.THREE;

/**
 * Normaliza um modelo GLB para o "espaço unitário": centraliza o modelo na origem e o escala
 * para que a maior dimensão renderizada meça exatamente 1 unidade.
 *
 * A medição é precisa (vértices já deformados pelo esqueleto), pois o bounding box padrão de
 * malhas com skinning ignora as escalas dos ossos e produz tamanhos e centros incorretos.
 * Com isso, as coordenadas dos marcadores independem da unidade nativa do arquivo e a escala
 * final no mundo é definida apenas pelo escalonamento do contêiner pai.
 */
export function normalizeModelToUnit(
  THREE: ThreeLib,
  model: Object3D,
  mixer: AnimationMixer | null,
): boolean {
  // reseta transformações aplicadas em uma normalização anterior
  model.position.set(0, 0, 0);
  model.scale.set(1, 1, 1);

  model.updateMatrixWorld(true);
  mixer?.update(0);
  model.updateMatrixWorld(true);
  model.traverse((child) => {
    const skinned = child as SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.frustumCulled = false;
      skinned.skeleton.update();
    }
  });

  const box = new THREE.Box3().setFromObject(model, true);
  if (box.isEmpty()) return false;

  // converte o volume para o espaço local do pai do modelo (assume transformação de similaridade)
  if (model.parent) {
    model.parent.updateWorldMatrix(true, false);
    box.applyMatrix4(model.parent.matrixWorld.clone().invert());
  }

  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim < 1e-9) return false;

  const center = box.getCenter(new THREE.Vector3());
  const k = 1 / maxDim;
  model.scale.setScalar(k);
  model.position.copy(center).multiplyScalar(-k);
  model.updateMatrixWorld(true);
  return true;
}

