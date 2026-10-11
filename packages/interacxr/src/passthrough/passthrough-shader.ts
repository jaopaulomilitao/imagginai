export const MASK_MODE = {
  FULL: 0,
  BOTTOM_WINDOW: 1,
} as const;

export type MaskMode = (typeof MASK_MODE)[keyof typeof MASK_MODE];

export const passthroughVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// uniformes da seção 3.7: uVideo, uOpacity, uMaskMode (0 = inteiro, 1 = janela inferior),
// uFeather (suavidade da borda da janela) e uK1 (distorção radial leve)
export const passthroughFragmentShader = /* glsl */ `
  uniform sampler2D uVideo;
  uniform float uOpacity;
  uniform float uMaskMode;
  uniform float uFeather;
  uniform float uK1;

  varying vec2 vUv;

  // topo da janela inferior, em coordenadas uv do plano
  const float WINDOW_TOP = 0.45;

  void main() {
    vec2 centered = vUv - 0.5;
    float radiusSquared = dot(centered, centered);
    vec2 sampleUv = centered * (1.0 + uK1 * radiusSquared) + 0.5;

    // são descartadas as bordas para evitar repetição da textura após a distorção
    if (any(lessThan(sampleUv, vec2(0.0))) || any(greaterThan(sampleUv, vec2(1.0)))) discard;

    float mask = 1.0;
    if (uMaskMode > 0.5) {
      mask = 1.0 - smoothstep(WINDOW_TOP - uFeather, WINDOW_TOP, vUv.y);
    }

    float alpha = uOpacity * mask;
    if (alpha <= 0.001) discard;

    gl_FragColor = vec4(texture2D(uVideo, sampleUv).rgb, alpha);
    #include <colorspace_fragment>
  }
`;
