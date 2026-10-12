// tipagem manual do a-frame 1.7.x; são declarados apenas os membros usados pela biblioteca e pelo app,
// conferidos contra o código-fonte instalado em node_modules/aframe/src
declare module 'aframe' {
  import type * as ThreeNamespace from 'three';

  export type Three = typeof ThreeNamespace;

  export interface Entity extends HTMLElement {
    readonly object3D: ThreeNamespace.Object3D;
    readonly sceneEl: Scene;
    readonly components: Record<string, Component | undefined>;
    readonly hasLoaded: boolean;
    getObject3D(type: string): ThreeNamespace.Object3D | undefined;
    setObject3D(type: string, object: ThreeNamespace.Object3D): void;
    removeObject3D(type: string): void;
    emit(name: string, detail?: unknown, bubbles?: boolean): void;
    is(state: string): boolean;
    setAttribute(name: string, value: unknown): void;
    setAttribute(name: string, property: string, value: unknown): void;
  }

  export interface Scene extends Entity {
    readonly camera: ThreeNamespace.Camera;
    readonly renderer: ThreeNamespace.WebGLRenderer;
    readonly systems: Record<string, System | undefined>;
    readonly isMobile: boolean;
    enterVR(useAR?: boolean, useOfferSession?: boolean): Promise<void>;
    exitVR(): Promise<void>;
  }

  export interface Component<TData = unknown> {
    readonly el: Entity;
    readonly data: TData;
    readonly id: string;
    readonly name: string;
  }

  export interface System<TData = unknown> {
    readonly el: Scene;
    readonly sceneEl: Scene;
    readonly data: TData;
  }

  type SchemaPropertyType =
    | 'array'
    | 'asset'
    | 'audio'
    | 'boolean'
    | 'color'
    | 'int'
    | 'map'
    | 'model'
    | 'number'
    | 'selector'
    | 'selectorAll'
    | 'string'
    | 'time'
    | 'vec2'
    | 'vec3'
    | 'vec4';

  export interface SchemaProperty {
    type?: SchemaPropertyType;
    default?: unknown;
    oneOf?: readonly string[];
  }

  export type Schema = Record<string, SchemaProperty>;

  // o "this" de cada método é o próprio componente, tipado por quem o registra
  export interface ComponentDefinition<TSelf extends Component> {
    schema?: Schema;
    dependencies?: readonly string[];
    multiple?: boolean;
    init?(this: TSelf): void;
    update?(this: TSelf, oldData: Partial<TSelf['data']>): void;
    tick?(this: TSelf, time: number, timeDelta: number): void;
    tock?(this: TSelf, time: number, timeDelta: number): void;
    play?(this: TSelf): void;
    pause?(this: TSelf): void;
    remove?(this: TSelf): void;
  }

  export interface SystemDefinition<TSelf extends System> {
    schema?: Schema;
    init?(this: TSelf): void;
    tick?(this: TSelf, time: number, timeDelta: number): void;
    play?(this: TSelf): void;
    pause?(this: TSelf): void;
  }

  export interface AFrameGlobal {
    readonly version: string;
    readonly THREE: Three;
    readonly components: Record<string, unknown>;
    readonly systems: Record<string, unknown>;
    registerComponent<TSelf extends Component>(
      name: string,
      definition: ComponentDefinition<TSelf>,
    ): void;
    registerSystem<TSelf extends System>(name: string, definition: SystemDefinition<TSelf>): void;
  }

  const AFRAME: AFrameGlobal;
  export default AFRAME;
}

declare module 'aframe-troika-text';
