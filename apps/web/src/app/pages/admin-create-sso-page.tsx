import {
  ArrowLeft,
  Cube,
  DownloadSimple,
  Eye,
  Goggles,
  HandPointing,
  MapPin,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import AFRAME from 'aframe';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type {
  AnimationAction,
  AnimationMixer,
  Group,
  Mesh,
  PerspectiveCamera,
  Raycaster,
  Scene,
  WebGLRenderer,
} from 'three';

import { zoneStorage } from '../../shared/storage/dexie-db';
import { normalizeModelToUnit } from '../../shared/three/normalize-model';
import type { SsoAnnotation, SpecialStudyObjectAsset } from '../../shared/types/study-pack';
import type { ZoneTheme } from '../../zone/config/constants';
import { AppNavbar } from '../components/app-navbar';

// tamanho de exibição do modelo no viewport (as coordenadas dos marcadores são normalizadas)
const ADMIN_DISPLAY_SIZE = 0.52;

export interface AdminCreateSsoPageProps {
  readonly themeId: ZoneTheme;
  readonly onToggleTheme: () => void;
  readonly userEmail: string | null;
  readonly onOpenConsent: () => void;
  readonly onSignOut: () => void;
}

const DEFAULT_ANNOTATIONS: SsoAnnotation[] = [
  {
    id: 'ann-aorta',
    title: 'Artéria Aorta',
    description:
      'Maior artéria do corpo humano, distribui sangue oxigenado ejetado pelo ventrículo esquerdo para toda a circulação sistêmica.',
    position: [0.02, 0.42, 0.0],
    pageAnchor: 14,
  },
  {
    id: 'ann-atrio-direito',
    title: 'Átrio Direito',
    description:
      'Câmara que recebe o sangue venoso desoxigenado de todo o corpo através das veias cavas superior e inferior.',
    position: [-0.2, 0.1, 0.1],
    pageAnchor: 14,
  },
  {
    id: 'ann-ventriculo-esquerdo',
    title: 'Ventrículo Esquerdo',
    description:
      'Câmara de parede miocárdica espessa, responsável pela contração sistólica de alta pressão para suprir os tecidos periféricos.',
    position: [0.15, -0.25, 0.05],
    pageAnchor: 15,
  },
  {
    id: 'ann-ventriculo-direito',
    title: 'Ventrículo Direito',
    description:
      'Bombeia sangue venoso para os pulmões através da artéria pulmonar para realização da hematose e oxigenação.',
    position: [-0.1, -0.28, 0.15],
    pageAnchor: 15,
  },
  {
    id: 'ann-tronco-pulmonar',
    title: 'Tronco Pulmonar',
    description:
      'Origina-se no ventrículo direito e bifurca-se nas artérias pulmonares direita e esquerda em direção aos alvéolos.',
    position: [-0.08, 0.36, 0.12],
    pageAnchor: 16,
  },
];

export function AdminCreateSsoPage({
  themeId,
  onToggleTheme,
  userEmail,
  onOpenConsent,
  onSignOut,
}: AdminCreateSsoPageProps) {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // estados do Objeto de Estudo Especial
  const [title, setTitle] = useState('Coração 3D em Batimento (OEE)');
  const [whySpatial, setWhySpatial] = useState(
    'Permite analisar volumetricamente as câmaras cardíacas, grandes vasos e o ciclo de batimento em tempo real em 360 graus.',
  );
  const [modelUrl, setModelUrl] = useState('/models/beating_heart_3d.glb');
  const [tags, setTags] = useState('coração, anatomia, cardiovascular, átrios, ventrículos, aorta');
  const [annotations, setAnnotations] = useState<SsoAnnotation[]>(DEFAULT_ANNOTATIONS);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  // ferramenta de interação 3D: orbitar câmera vs posicionar marcador
  const [interactionMode, setInteractionMode] = useState<'orbit' | 'add_marker'>('orbit');
  const [isSavedLocally, setIsSavedLocally] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // referências Three.js para o viewport
  const threeRef = useRef<{
    scene: Scene;
    camera: PerspectiveCamera;
    renderer: WebGLRenderer;
    modelGroup: Group;
    mixer: AnimationMixer | null;
    actions: AnimationAction[];
    pinMeshes: Mesh[];
    raycaster: Raycaster;
    yaw: number;
    pitch: number;
    radius: number;
    isDragging: boolean;
    lastMouseX: number;
    lastMouseY: number;
    hasMovedDuringClick: boolean;
  } | null>(null);

  // inicializa o renderizador Three.js no canvas WebGL
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const THREE = AFRAME.THREE;
    const width = canvas.clientWidth || 640;
    const height = canvas.clientHeight || 520;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(themeId === 'dark-glass' ? 0x0a0f1d : 0xf8f9fc);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 50);
    const radius = 1.0;
    const yaw = 0.4;
    const pitch = 0.2;
    camera.position.set(
      radius * Math.sin(yaw) * Math.cos(pitch),
      radius * Math.sin(pitch),
      radius * Math.cos(yaw) * Math.cos(pitch),
    );
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // iluminação suave
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight1.position.set(2, 4, 3);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x236cfe, 0.6);
    dirLight2.position.set(-3, -2, -2);
    scene.add(dirLight2);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    const raycaster = new THREE.Raycaster();

    threeRef.current = {
      scene,
      camera,
      renderer,
      modelGroup,
      mixer: null,
      actions: [],
      pinMeshes: [],
      raycaster,
      yaw,
      pitch,
      radius,
      isDragging: false,
      lastMouseX: 0,
      lastMouseY: 0,
      hasMovedDuringClick: false,
    };

    // carrega modelo 3D GLB
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loader = new (THREE as any).GLTFLoader();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader.load(modelUrl, (gltf: any) => {
      const model = gltf.scene;
      modelGroup.clear();
      modelGroup.add(model);

      // inicia animação de batimento
      if (gltf.animations && gltf.animations.length > 0) {
        const mixer = new THREE.AnimationMixer(model);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const actions = gltf.animations.map((clip: any) => {
          const act = mixer.clipAction(clip);
          act.setLoop(THREE.LoopRepeat, Infinity);
          act.play();
          return act;
        });
        if (threeRef.current) {
          threeRef.current.mixer = mixer;
          threeRef.current.actions = actions;
        }
      }

      // centraliza na origem e normaliza para 1 unidade (mesmo espaço de coordenadas usado na Zona VR)
      const mixerNow = threeRef.current?.mixer ?? null;
      normalizeModelToUnit(THREE, model, mixerNow);
      modelGroup.scale.setScalar(ADMIN_DISPLAY_SIZE);
    });

    let animationFrameId: number;
    let lastTime = performance.now();

    const animate = (time: number) => {
      animationFrameId = requestAnimationFrame(animate);
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      if (threeRef.current?.mixer) {
        threeRef.current.mixer.update(dt);
      }
      renderer.render(scene, camera);
    };
    animationFrameId = requestAnimationFrame(animate);

    const handleResize = () => {
      if (!canvas) return;
      const w = canvas.clientWidth || 640;
      const h = canvas.clientHeight || 520;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [modelUrl, themeId]);

  // sincroniza a renderização dos marcadores tridimensionais (pins) no Three.js
  useEffect(() => {
    if (!threeRef.current) return;
    const { modelGroup, pinMeshes } = threeRef.current;
    const THREE = AFRAME.THREE;

    // remove pins antigos
    pinMeshes.forEach((mesh) => modelGroup.remove(mesh));
    pinMeshes.length = 0;

    // recria cada pin como uma esfera discreta branca com contorno preto nas coordenadas exatas
    annotations.forEach((ann, idx) => {
      const isSelected = ann.id === selectedPinId;
      const geom = new THREE.SphereGeometry(0.014 / ADMIN_DISPLAY_SIZE, 16, 16);
      const mat = new THREE.MeshBasicMaterial({
        color: isSelected ? 0xf06131 : 0xffffff,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(ann.position[0], ann.position[1], ann.position[2]);
      mesh.name = `pin-${ann.id}`;
      mesh.userData = { annotationId: ann.id, index: idx };

      // traçado preto nítido em 360 graus
      const borderGeom = new THREE.SphereGeometry(0.018 / ADMIN_DISPLAY_SIZE, 16, 16);
      const borderMat = new THREE.MeshBasicMaterial({
        color: isSelected ? 0xffffff : 0x000000,
        side: THREE.BackSide,
      });
      const borderMesh = new THREE.Mesh(borderGeom, borderMat);
      mesh.add(borderMesh);

      modelGroup.add(mesh);
      pinMeshes.push(mesh);
    });
  }, [annotations, selectedPinId]);

  // manipuladores de evento de mouse / ponteiro para rotação e clique de posicionamento
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!threeRef.current) return;
    threeRef.current.isDragging = true;
    threeRef.current.lastMouseX = e.clientX;
    threeRef.current.lastMouseY = e.clientY;
    threeRef.current.hasMovedDuringClick = false;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!threeRef.current || !threeRef.current.isDragging) return;
    const dx = e.clientX - threeRef.current.lastMouseX;
    const dy = e.clientY - threeRef.current.lastMouseY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      threeRef.current.hasMovedDuringClick = true;
    }

    threeRef.current.lastMouseX = e.clientX;
    threeRef.current.lastMouseY = e.clientY;

    // rotação orbital
    threeRef.current.yaw -= dx * 0.008;
    threeRef.current.pitch = Math.max(-1.4, Math.min(1.4, threeRef.current.pitch + dy * 0.008));

    const { camera, radius, yaw, pitch } = threeRef.current;
    camera.position.set(
      radius * Math.sin(yaw) * Math.cos(pitch),
      radius * Math.sin(pitch),
      radius * Math.cos(yaw) * Math.cos(pitch),
    );
    camera.lookAt(0, 0, 0);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!threeRef.current) return;
    const wasDragging = threeRef.current.isDragging;
    const hasMoved = threeRef.current.hasMovedDuringClick;
    threeRef.current.isDragging = false;

    // se o usuário clicou sem arrastar e está no modo "adicionar marcador"
    if (wasDragging && !hasMoved && interactionMode === 'add_marker') {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const { camera, raycaster, modelGroup } = threeRef.current;
      raycaster.setFromCamera(new AFRAME.THREE.Vector2(x, y), camera);

      // intercepta malha do modelo
      const hits = raycaster.intersectObjects(modelGroup.children, true);
      const hit = hits.find((h) => !h.object.name.startsWith('pin-'));

      if (hit) {
        // converte do espaço de mundo para o espaço local do modelo
        const localPos = modelGroup.worldToLocal(hit.point.clone());
        const newPinId = `ann-${Date.now()}`;
        const newPin: SsoAnnotation = {
          id: newPinId,
          title: `Ponto Clínico ${annotations.length + 1}`,
          description: 'Descrição anatômica detalhada desta estrutura cardiovascular.',
          position: [
            parseFloat(localPos.x.toFixed(3)),
            parseFloat(localPos.y.toFixed(3)),
            parseFloat(localPos.z.toFixed(3)),
          ],
          pageAnchor: 15,
        };

        setAnnotations((prev) => [...prev, newPin]);
        setSelectedPinId(newPinId);
        setInteractionMode('orbit'); // volta para órbita para inspecionar
        setSaveToast('Marcador 3D posicionado com sucesso!');
        setTimeout(() => setSaveToast(null), 3000);
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!threeRef.current) return;
    threeRef.current.radius = Math.max(
      0.35,
      Math.min(2.5, threeRef.current.radius + e.deltaY * 0.0015),
    );
    const { camera, radius, yaw, pitch } = threeRef.current;
    camera.position.set(
      radius * Math.sin(yaw) * Math.cos(pitch),
      radius * Math.sin(pitch),
      radius * Math.cos(yaw) * Math.cos(pitch),
    );
    camera.lookAt(0, 0, 0);
  };

  const handleUploadGlb = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setModelUrl(url);
      setSaveToast(`Modelo "${file.name}" carregado.`);
      setTimeout(() => setSaveToast(null), 3000);
    }
  };

  // monta o objeto exportável completo
  const buildCurrentSsoAsset = (): SpecialStudyObjectAsset => ({
    id: 'asset-heart-sso',
    kind: 'special-study-object',
    title,
    whySpatial,
    modelUrl,
    tags: tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    scale: [1.0, 1.0, 1.0],
    annotations,
  });

  // salva o OEE nos pacotes das Zonas de Anatomia e Cardiovascular do Dexie local para teste imediato
  const handleSaveToZones = async () => {
    const ssoAsset = buildCurrentSsoAsset();

    try {
      const targetZoneIds = ['zone-demo-saude-anatomia-humana', 'demo', 'zone-demo'];
      for (const zoneId of targetZoneIds) {
        const storedPack = await zoneStorage.loadStudyPack(zoneId);
        if (storedPack) {
          const nextAssets = [...storedPack.assets.filter((a) => a.id !== ssoAsset.id), ssoAsset];
          const updatedPack = { ...storedPack, assets: nextAssets };
          await zoneStorage.saveStudyPack(zoneId, updatedPack);
        }
      }

      setIsSavedLocally(true);
      setSaveToast('OEE salvo e ativado nas Zonas de Anatomia e Cardiovascular!');
      setTimeout(() => setSaveToast(null), 4000);
    } catch {
      setSaveToast('Erro ao salvar localmente no IndexedDB.');
      setTimeout(() => setSaveToast(null), 3000);
    }
  };

  // download do arquivo JSON pronto para Supabase ou repositório
  const handleDownloadJson = () => {
    const ssoAsset = buildCurrentSsoAsset();
    const jsonStr = JSON.stringify(ssoAsset, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sso-${ssoAsset.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="imx-shell">
      <AppNavbar
        themeId={themeId}
        onToggleTheme={onToggleTheme}
        userEmail={userEmail}
        onOpenConsent={onOpenConsent}
        onSignOut={onSignOut}
      />

      <main className="w-full max-w-[74rem] flex flex-col gap-5">
        {/* Barra superior de navegação administrativa */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="imx-glass-button p-2 text-xs"
              title="Voltar para a página inicial"
            >
              <ArrowLeft size={16} weight="bold" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="imx-heading text-xl sm:text-2xl font-black m-0 tracking-tight">
                  Estúdio de Objetos de Estudo Especiais (OEE)
                </h1>
                <span className="imx-badge imx-badge-warm">Administração</span>
              </div>
              <p
                className="text-xs m-0 mt-0.5 opacity-75 font-mono"
                style={{ color: 'var(--imx-text-muted)' }}
              >
                Criação e anotação tridimensional de simulações e modelos 3D anatômicos
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadJson}
              className="imx-glass-button text-xs py-2 px-3"
              title="Baixar definição em JSON"
            >
              <DownloadSimple size={16} weight="bold" />
              <span>Exportar JSON</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSaveToZones()}
              className="imx-glass-button imx-button-primary text-xs py-2 px-4"
            >
              <Plus size={16} weight="bold" />
              <span>Salvar nas Zonas (VR)</span>
            </button>
          </div>
        </div>

        {saveToast && (
          <div className="p-3 rounded-xl bg-[var(--imx-accent-darkblue-soft)] border border-[var(--imx-accent-darkblue)] text-xs text-[var(--imx-accent-darkblue)] font-bold flex items-center justify-between animate-in fade-in">
            <span>{saveToast}</span>
            {isSavedLocally && (
              <button
                type="button"
                onClick={() =>
                  navigate(
                    '/zone.html?zoneId=zone-demo-saude-anatomia-humana&packId=cbe9d5fb-ab7a-4776-9ede-ed22110d023f',
                  )
                }
                className="imx-glass-button imx-button-accent text-xs py-1 px-3 ml-3"
              >
                <Goggles size={16} weight="bold" />
                <span>Testar na Zona VR Agora</span>
              </button>
            )}
          </div>
        )}

        {/* Grade principal: Viewport 3D à esquerda + Painel de Marcadores à direita */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Coluna 3D Interativa */}
          <div className="lg:col-span-7 flex flex-col gap-3">
            <div className="imx-glass-card p-0 overflow-hidden relative rounded-2xl border border-[var(--imx-border-solid)] shadow-xl">
              {/* Barra de ferramentas flutuante do Viewport 3D */}
              <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 p-1.5 rounded-xl bg-[var(--imx-bg-surface)] backdrop-blur-md border border-[var(--imx-border-subtle)] shadow-md">
                <button
                  type="button"
                  onClick={() => setInteractionMode('orbit')}
                  className={`text-xs py-1 px-2.5 rounded-lg font-mono flex items-center gap-1.5 transition-all ${
                    interactionMode === 'orbit'
                      ? 'bg-[var(--imx-accent-darkblue)] text-white font-bold shadow-sm'
                      : 'text-[var(--imx-text-body)] hover:bg-[var(--imx-bg-card)]'
                  }`}
                >
                  <Eye size={15} weight="bold" />
                  <span>Orbitar Câmera</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInteractionMode('add_marker')}
                  className={`text-xs py-1 px-2.5 rounded-lg font-mono flex items-center gap-1.5 transition-all ${
                    interactionMode === 'add_marker'
                      ? 'bg-[var(--imx-accent-warm)] text-white font-bold shadow-sm'
                      : 'text-[var(--imx-text-body)] hover:bg-[var(--imx-bg-card)]'
                  }`}
                  title="Clique na superfície do coração para fixar um novo ponto"
                >
                  <HandPointing size={15} weight="bold" />
                  <span>Posicionar Marcador (+)</span>
                </button>
              </div>

              {/* Status do modelo e instrução */}
              <div className="absolute bottom-3 left-3 z-10 text-[11px] font-mono px-2.5 py-1 rounded-lg bg-[var(--imx-bg-surface)] border border-[var(--imx-border-subtle)] backdrop-blur-md opacity-85">
                {interactionMode === 'add_marker'
                  ? 'Modo Ativo: Clique sobre o coração para criar um marcador'
                  : 'Arraste para girar • Roda do mouse para aproximar'}
              </div>

              {/* Canvas WebGL Three.js */}
              <canvas
                ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onWheel={handleWheel}
                className="w-full h-[480px] sm:h-[540px] block cursor-grab active:cursor-grabbing"
              />
            </div>

            {/* Carregar outro arquivo GLB */}
            <div className="imx-glass-card p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <Cube size={18} weight="bold" className="text-[var(--imx-accent-warm)]" />
                <span className="font-mono">
                  Arquivo: <strong>{modelUrl}</strong> (Animação ativa)
                </span>
              </div>
              <label className="imx-glass-button text-xs py-1.5 px-3 cursor-pointer">
                <span>Trocar arquivo .GLB</span>
                <input
                  type="file"
                  accept=".glb,.gltf"
                  onChange={handleUploadGlb}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Coluna de Configuração e Marcadores */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Metadados Pedagógicos do OEE */}
            <div className="imx-glass-card flex flex-col gap-3">
              <h3 className="imx-heading text-base font-bold m-0 flex items-center gap-2">
                <Cube size={18} weight="bold" />
                <span>Dados do Objeto Especial</span>
              </h3>

              <div>
                <label className="block text-[11px] font-mono uppercase tracking-wider text-[var(--imx-text-muted)] mb-1">
                  Título do Objeto
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="imx-input text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase tracking-wider text-[var(--imx-text-muted)] mb-1">
                  Justificativa Espacial (whySpatial)
                </label>
                <textarea
                  value={whySpatial}
                  onChange={(e) => setWhySpatial(e.target.value)}
                  rows={2}
                  className="imx-input text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase tracking-wider text-[var(--imx-text-muted)] mb-1">
                  Tags Semânticas (para Recomendação por IA)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="ex: anatomia, coração, cardiovascular"
                  className="imx-input text-xs"
                />
              </div>
            </div>

            {/* Lista de Marcadores Clínicos / Anatômicos */}
            <div className="imx-glass-card flex flex-col gap-3">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--imx-border-subtle)]">
                <div className="flex items-center gap-2">
                  <MapPin size={18} weight="bold" className="text-[var(--imx-accent-warm)]" />
                  <h3 className="imx-heading text-base font-bold m-0">
                    Marcadores ({annotations.length})
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setInteractionMode('add_marker')}
                  className="imx-glass-button text-xs py-1 px-2.5"
                >
                  <Plus size={14} weight="bold" />
                  <span>Novo Ponto</span>
                </button>
              </div>

              <div className="flex flex-col gap-3 max-h-[460px] overflow-y-auto pr-1">
                {annotations.map((ann, idx) => {
                  const isSelected = ann.id === selectedPinId;
                  return (
                    <div
                      key={ann.id}
                      onClick={() => setSelectedPinId(ann.id)}
                      className={`p-3 rounded-xl border transition-all flex flex-col gap-2 cursor-pointer ${
                        isSelected
                          ? 'border-[var(--imx-accent-darkblue)] bg-[var(--imx-accent-darkblue-soft)]'
                          : 'border-[var(--imx-border-subtle)] bg-[var(--imx-bg-card-alt)] hover:border-[var(--imx-border-strong)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-[var(--imx-accent-warm)]">
                          [{String(idx + 1).padStart(2, '0')}]
                        </span>
                        <input
                          type="text"
                          value={ann.title}
                          onChange={(e) => {
                            const val = e.target.value;
                            setAnnotations((prev) =>
                              prev.map((a) => (a.id === ann.id ? { ...a, title: val } : a)),
                            );
                          }}
                          className="imx-input text-xs font-bold py-1 px-2 flex-1"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAnnotations((prev) => prev.filter((a) => a.id !== ann.id));
                            if (selectedPinId === ann.id) setSelectedPinId(null);
                          }}
                          className="text-[var(--imx-accent-danger)] hover:opacity-80 p-1"
                          title="Excluir marcador"
                        >
                          <Trash size={16} weight="bold" />
                        </button>
                      </div>

                      <textarea
                        value={ann.description}
                        rows={2}
                        onChange={(e) => {
                          const val = e.target.value;
                          setAnnotations((prev) =>
                            prev.map((a) => (a.id === ann.id ? { ...a, description: val } : a)),
                          );
                        }}
                        placeholder="Explicação anatômica"
                        className="imx-input text-xs py-1 px-2"
                      />

                      <div className="flex items-center justify-between text-[11px] font-mono text-[var(--imx-text-muted)]">
                        <span>Pos: ({ann.position.map((p) => p.toFixed(2)).join(', ')})</span>
                        <div className="flex items-center gap-1.5">
                          <span>Pág. PDF:</span>
                          <input
                            type="number"
                            min={1}
                            value={ann.pageAnchor ?? 1}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10) || 1;
                              setAnnotations((prev) =>
                                prev.map((a) => (a.id === ann.id ? { ...a, pageAnchor: val } : a)),
                              );
                            }}
                            className="imx-input text-xs py-0.5 px-1.5 w-14 text-center font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
