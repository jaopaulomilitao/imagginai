import type { Entity } from 'aframe';
import type { Object3D } from 'three';

// o a-frame grava a entidade dona em object3D.el; sobe-se na hierarquia até encontrá-la
export function findOwnerEntity(object: Object3D): Entity | null {
  let current: Object3D | null = object;
  while (current) {
    const owner: unknown = Reflect.get(current, 'el');
    if (owner instanceof HTMLElement) return owner as Entity;
    current = current.parent;
  }
  return null;
}

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}
