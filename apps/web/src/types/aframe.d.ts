// são declarados apenas os membros do a-frame 1.7.x efetivamente usados pelo app,
// pois o pacote não publica tipos próprios
declare module 'aframe' {
  interface AFrameGlobal {
    readonly version: string;
  }

  const AFRAME: AFrameGlobal;
  export default AFRAME;
}
