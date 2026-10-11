import type { Entity } from 'aframe';
import type { Object3D } from 'three';

import { domObserverFactory, TargetCache } from '../core/target-cache';

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

// object3d de todas as entidades que casam com o seletor, atualizado só quando a cena muda
export function createObject3DCache(scene: Entity, selector: string): TargetCache<Object3D> {
  const query = () =>
    Array.from(scene.querySelectorAll<Entity>(selector)).map((entity) => entity.object3D);
  return new TargetCache(query, domObserverFactory(scene));
}
