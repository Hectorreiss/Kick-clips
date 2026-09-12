import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Link2, Upload, Play, Pause, Volume2, VolumeX, Scissors, Download,
  Layers as LayersIcon, Type, Image as ImageIcon, Eye, EyeOff, Lock,
  Unlock, Copy, Trash2, Crosshair, Maximize2, Wand2, Undo2, Redo2, X,
  Info, Video, Camera as CameraIcon, ChevronUp, ChevronDown, Settings2,
  Film, Loader2, Check, MonitorPlay, Smartphone, Rows, SquareStack,
  MousePointer2, RotateCcw, Sparkles
} from "lucide-react";

/* ---------------------------------- constants ---------------------------------- */

const CANVAS_W = 1080, CANVAS_H = 1920;

const defaultGameplay = () => ({
  x: 0, y: 0, w: 100, h: 100,
  cropX: 0, cropY: 0, cropW: 100, cropH: 100,
  rotation: 0,
});

const defaultCamera = () => ({
  x: 60, y: 4, w: 36, h: 23,
  cropX: 3, cropY: 8, cropW: 26, cropH: 34,
  rotation: 0,
});

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function fmtTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Largest centered crop of a src (w/h) that matches dest aspect ratio, no distortion.
function centerCrop(destW, destH, srcW, srcH) {
  if (!srcW || !srcH || !destW || !destH) return { cropX: 0, cropY: 0, cropW: 100, cropH: 100 };
  const destAspect = destW / destH;
  const srcAspect = srcW / srcH;
  let cw, ch;
  if (srcAspect > destAspect) { ch = 100; cw = (destAspect / srcAspect) * 100; }
  else { cw = 100; ch = (srcAspect / destAspect) * 100; }
  return { cropX: (100 - cw) / 2, cropY: (100 - ch) / 2, cropW: cw, cropH: ch };
}

function applyResize(box, corner, dxPct, dyPct) {
  let { x, y, w, h } = box;
  if (corner.includes("e")) w = clamp(w + dxPct, 5, 100 - x);
  if (corner.includes("w")) { const nx = clamp(x + dxPct, 0, x + w - 5); w = w + (x - nx); x = nx; }
  if (corner.includes("s")) h = clamp(h + dyPct, 5, 100 - y);
  if (corner.includes("n")) { const ny = clamp(y + dyPct, 0, y + h - 5); h = h + (y - ny); y = ny; }
  return { ...box, x, y, w, h };
}

const FULLSCREEN_PRESETS = [
  { id: "superior", label: "Câmera superior", box: { x: 33, y: 4, w: 34, h: 21 } },
  { id: "inferior", label: "Câmera inferior", box: { x: 33, y: 75, w: 34, h: 21 } },
  { id: "esquerda", label: "Câmera esquerda", box: { x: 3, y: 40, w: 34, h: 21 } },
  { id: "direita", label: "Câmera direita", box: { x: 63, y: 40, w: 34, h: 21 } },
];

const STACKED_PRESETS = [
  { id: "cima", label: "Câmera em cima", cam: { x: 0, y: 0, w: 100, h: 45 }, game: { x: 0, y: 45, w: 100, h: 55 } },
  { id: "embaixo", label: "Câmera embaixo", cam: { x: 0, y: 55, w: 100, h: 45 }, game: { x: 0, y: 0, w: 100, h: 55 } },
  { id: "pequena", label: "Câmera pequena", cam: { x: 0, y: 0, w: 100, h: 26 }, game: { x: 0, y: 26, w: 100, h: 74 } },
  { id: "grande", label: "Câmera grande", cam: { x: 0, y: 0, w: 100, h: 62 }, game: { x: 0, y: 62, w: 100, h: 38 } },
];

/* ---------------------------------- small UI atoms ---------------------------------- */

function Field({ label, value, min, max, step = 1, unit = "%", onChange, onCommit }) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-neutral-400">{label}</span>
        <span className="text-xs font-mono text-neutral-300">{Math.round(value)}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onMouseUp={onCommit} onTouchEnd={onCommit}
        className="w-full accent-violet-500 h-1.5 cursor-pointer"
      />
    </div>
  );
}

function IconBtn({ children, onClick, active, title, disabled }) {
  return (
    <button
      title={title} disabled={disabled} onClick={onClick}
      className={
        "p-1.5 rounded-md transition-colors " +
        (disabled ? "text-neutral-700 cursor-not-allowed" :
          active ? "bg-violet-600 text-white" : "text-neutral-400 hover:text-white hover:bg-neutral-800")
      }
    >
      {children}
    </button>
  );
}

function PresetBtn({ label, onClick, active }) {
  return (
    <button
      onClick={onClick}
      className={
        "px-3 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap " +
        (active ? "bg-violet-600 border-violet-500 text-white" : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:border-neutral-600")
      }
    >
      {label}
    </button>
  );
}

/* ---------------------------------- draggable layer box ---------------------------------- */

function LayerBox({ id, box, color, label, selected, locked, hidden, onSelect, onChange, onCommit, containerRef }) {
  const dragState = useRef(null);

  const startDrag = (e, mode, corner) => {
    if (locked || hidden) return;
    e.stopPropagation();
    onSelect(id);
    const rect = containerRef.current.getBoundingClientRect();
    dragState.current = {
      mode, corner, rect,
      startX: e.clientX, startY: e.clientY,
      startBox: { ...box },
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onMove = (e) => {
    const d = dragState.current;
    if (!d) return;
    const precision = e.shiftKey ? 0.25 : 1;
    let dxPct = ((e.clientX - d.startX) / d.rect.width) * 100 * precision;
    let dyPct = ((e.clientY - d.startY) / d.rect.height) * 100 * precision;
    if (d.mode === "drag") {
      const nx = clamp(d.startBox.x + dxPct, 0, 100 - d.startBox.w);
      const ny = clamp(d.startBox.y + dyPct, 0, 100 - d.startBox.h);
      onChange({ ...d.startBox, x: nx, y: ny });
    } else if (d.mode === "resize") {
      onChange(applyResize(d.startBox, d.corner, dxPct, dyPct));
    }
  };

  const onUp = () => {
    dragState.current = null;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    onCommit && onCommit();
  };

  const onWheel = (e) => {
    if (!selected || locked || hidden) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1.5 : 1.5;
    const nw = clamp(box.w + delta, 5, 100);
    const nh = clamp(box.h + delta, 5, 100);
    const nx = clamp(box.x - (nw - box.w) / 2, 0, 100 - nw);
    const ny = clamp(box.y - (nh - box.h) / 2, 0, 100 - nh);
    onChange({ ...box, x: nx, y: ny, w: nw, h: nh });
  };

  if (hidden) return null;

  const corners = ["nw", "ne", "sw", "se"];
  const cursorFor = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };

  return (
    <div
      onMouseDown={(e) => startDrag(e, "drag")}
      onWheel={onWheel}
      onClick={(e) => { e.stopPropagation(); onSelect(id); }}
      style={{
        position: "absolute",
        left: box.x + "%", top: box.y + "%", width: box.w + "%", height: box.h + "%",
        border: `2px solid ${color}`,
        boxShadow: selected ? `0 0 0 1px ${color}66, 0 0 16px ${color}55` : "none",
        background: selected ? `${color}14` : "transparent",
        cursor: locked ? "not-allowed" : "move",
        borderRadius: 4,
      }}
    >
      <div
        className="absolute -top-6 left-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white select-none"
        style={{ background: color }}
      >
        {locked && <Lock size={10} />} {label}
      </div>
      {selected && !locked && corners.map((c) => (
        <div
          key={c}
          onMouseDown={(e) => startDrag(e, "resize", c)}
          style={{
            position: "absolute",
            width: 12, height: 12, background: "#fff", border: `2px solid ${color}`, borderRadius: 3,
            cursor: cursorFor[c],
            top: c.includes("n") ? -6 : "auto",
            bottom: c.includes("s") ? -6 : "auto",
            left: c.includes("w") ? -6 : "auto",
            right: c.includes("e") ? -6 : "auto",
          }}
        />
      ))}
    </div>
  );
}

/* ---------------------------------- main app ---------------------------------- */

export default function KickClipEditor() {
  const [stage, setStage] = useState("import"); // import | editor
  const [clipUrl, setClipUrl] = useState("");
  const [videoSrc, setVideoSrc] = useState(null);
  const [meta, setMeta] = useState({ duration: 0, width: 0, height: 0 });
  const [importError, setImportError] = useState("");

  // layout / mode
  const [mode, setMode] = useState("original"); // original | 916
  const [subMode, setSubMode] = useState("fullscreen"); // fullscreen | stacked | free

  // layers
  const [gameplay, setGameplay] = useState(defaultGameplay());
  const [camera, setCamera] = useState(defaultCamera());
  const [extraLayers, setExtraLayers] = useState([]);
  const [layerOrder, setLayerOrder] = useState(["gameplay", "camera"]);
  const [hiddenMap, setHiddenMap] = useState({});
  const [lockedMap, setLockedMap] = useState({});
  const [selected, setSelected] = useState("camera");
  const [followCam, setFollowCam] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [cameraDetected, setCameraDetected] = useState(false);

  // history
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);

  // playback
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);

  // export
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRes, setExportRes] = useState("1080x1920");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportResult, setExportResult] = useState(null);
  const [exportErr, setExportErr] = useState("");

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const previewWrapRef = useRef(null);  const fileInputRef = useRef(null);
  const importFileRef = useRef(null);
  const imgCache = useRef({});
  const stateRef = useRef({});
  const exportCanvasRef = useRef(null);
  const miniWrapRef = useRef(null);
  const miniCanvasRef = useRef(null);

  useEffect(() => {
    stateRef.current = { mode, subMode, gameplay, camera, extraLayers, layerOrder, hiddenMap };
  }, [mode, subMode, gameplay, camera, extraLayers, layerOrder, hiddenMap]);

  /* ---------------- history ---------------- */
  const snapshot = () => ({ gameplay, camera, extraLayers, layerOrder, hiddenMap, lockedMap, mode, subMode });
  const pushHistory = () => {
    setPast((p) => [...p.slice(-49), snapshot()]);
    setFuture([]);
  };
  const restore = (s) => {
    setGameplay(s.gameplay); setCamera(s.camera); setExtraLayers(s.extraLayers);
    setLayerOrder(s.layerOrder); setHiddenMap(s.hiddenMap); setLockedMap(s.lockedMap);
    setMode(s.mode); setSubMode(s.subMode);
  };
  const undo = () => {
    setPast((p) => {
      if (!p.length) return p;
      const last = p[p.length - 1];
      setFuture((f) => [snapshot(), ...f]);
      restore(last);
      return p.slice(0, -1);
    });
  };
  const redo = () => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setPast((p) => [...p, snapshot()]);
      restore(next);
      return f.slice(1);
    });
  };

  /* ---------------- keyboard shortcuts ---------------- */
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected && (selected.startsWith("text-") || selected.startsWith("img-"))) {
        e.preventDefault();
        removeExtraLayer(selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------------- import ---------------- */
  const [resolving, setResolving] = useState(false);

  const handleFilePicked = (file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
    setImportError("");
    setStage("editor");
  };

  const handleLoadClip = async () => {
    if (!clipUrl.trim()) {
      setImportError("Cole o link do clipe da Kick para continuar.");
      return;
    }
    if (!/kick\.com/i.test(clipUrl)) {
      setImportError("Isso não parece um link da Kick. Cole a URL de um clipe público.");
      return;
    }
    setImportError("");
    setResolving(true);
    try {
      const r = await fetch(`/api/resolve-clip?url=${encodeURIComponent(clipUrl)}`);
      const data = await r.json();
      if (!r.ok || !data.videoUrl) {
        setResolving(false);
        setImportError(data.error || "Não foi possível resolver esse clipe.");
        return;
      }
      setMeta({ duration: data.duration || 0, width: data.width || 0, height: data.height || 0 });
      const proxied = data.isHls
        ? `/api/proxy-manifest?url=${encodeURIComponent(data.videoUrl)}`
        : `/api/proxy-video?url=${encodeURIComponent(data.videoUrl)}`;
      setVideoSrc(proxied);
      setResolving(false);
      setStage("editor");
    } catch (e) {
      setResolving(false);
      setImportError(
        "Não consegui falar com o backend (rota /api/resolve-clip). Se você estiver rodando isso fora da Vercel (ex. só o preview do editor), essa rota não existe aqui."
      );
    }
  };

  const onImportMeta = (e) => {
    const v = e.target;
    setMeta({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
  };

  /* ---------------- editor: video metadata ---------------- */
  const onEditorMeta = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    setTrimEnd(v.duration);
    setMeta({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    const cc = centerCrop(CANVAS_W, CANVAS_H, v.videoWidth, v.videoHeight);
    setGameplay((g) => ({ ...g, ...cc }));
  };

  // Liga a fonte de vídeo ao <video> escondido usado pelo editor. Para
  // arquivos locais ou .mp4 é só apontar o src; para streams HLS (.m3u8)
  // precisa do hls.js (Safari toca .m3u8 nativamente, então pulamos a
  // biblioteca nesse caso).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;
    let hls;
    const isHls = /proxy-manifest|\.m3u8/i.test(videoSrc);
    if (isHls && !video.canPlayType("application/vnd.apple.mpegurl")) {
      import("hls.js").then(({ default: Hls }) => {
        if (Hls.isSupported()) {
          hls = new Hls();
          hls.loadSource(videoSrc);
          hls.attachMedia(video);
        } else {
          video.src = videoSrc;
        }
      });
    } else {
      video.src = videoSrc;
    }
    return () => { if (hls) hls.destroy(); };
  }, [videoSrc]);

  /* ---------------- playback ---------------- */
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      if (!scrubbing) setCurrentTime(v.currentTime);
      if (v.currentTime >= trimEnd) { v.pause(); setPlaying(false); }
    };
    const onEnded = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", onEnded);
    return () => { v.removeEventListener("timeupdate", onTime); v.removeEventListener("ended", onEnded); };
  }, [trimEnd, scrubbing]);

  useEffect(() => { if (videoRef.current) { videoRef.current.volume = volume; } }, [volume]);
  useEffect(() => { if (videoRef.current) { videoRef.current.muted = muted; } }, [muted]);

  /* ---------------- layout / preset helpers ---------------- */
  const setMainMode = (m) => {
    setMode(m);
    if (m === "916") applyLayout(subMode);
    pushHistory();
  };

  const applyLayout = (sm) => {
    setSubMode(sm);
    const v = videoRef.current;
    const vw = v?.videoWidth || 1280, vh = v?.videoHeight || 720;
    if (sm === "fullscreen") {
      const cc = centerCrop(CANVAS_W, CANVAS_H, vw, vh);
      setGameplay((g) => ({ ...g, x: 0, y: 0, w: 100, h: 100, ...cc }));
      const p = FULLSCREEN_PRESETS[0];
      setCamera((c) => ({ ...c, ...p.box }));
    } else if (sm === "stacked") {
      const p = STACKED_PRESETS[0];
      const gcc = centerCrop(CANVAS_W, CANVAS_H * (p.game.h / 100), vw, vh);
      setGameplay((g) => ({ ...g, ...p.game, ...gcc }));
      setCamera((c) => ({ ...c, ...p.cam }));
    } else {
      // livre: keep current values, just ensure something sane exists
    }
  };

  const applyFullscreenPreset = (p) => { setCamera((c) => ({ ...c, ...p.box })); pushHistory(); };
  const applyStackedPreset = (p) => {
    const v = videoRef.current;
    const vw = v?.videoWidth || 1280, vh = v?.videoHeight || 720;
    const gcc = centerCrop(CANVAS_W, CANVAS_H * (p.game.h / 100), vw, vh);
    setGameplay((g) => ({ ...g, ...p.game, ...gcc }));
    setCamera((c) => ({ ...c, ...p.cam }));
    pushHistory();
  };

  const centerLayer = (which) => {
    const setter = which === "camera" ? setCamera : setGameplay;
    setter((b) => ({ ...b, x: (100 - b.w) / 2, y: (100 - b.h) / 2 }));
    pushHistory();
  };
  const fillLayer = (which) => {
    const setter = which === "camera" ? setCamera : setGameplay;
    setter((b) => ({ ...b, x: 0, y: 0, w: 100, h: 100 }));
    pushHistory();
  };
  const resetLayer = (which) => {
    if (which === "camera") setCamera(defaultCamera()); else {
      const v = videoRef.current;
      const cc = centerCrop(CANVAS_W, CANVAS_H, v?.videoWidth || 1280, v?.videoHeight || 720);
      setGameplay({ ...defaultGameplay(), ...cc });
    }
    pushHistory();
  };

  /* ---------------- auto detect camera ---------------- */
  const detectCamera = () => {
    setDetecting(true);
    setTimeout(() => {
      // Lightweight heuristic placeholder: em produção isso roda um modelo de
      // detecção facial/objeto no backend. Aqui aplicamos uma região típica
      // de webcam (canto inferior esquerdo) como ponto de partida editável.
      setCamera((c) => ({ ...c, cropX: 2, cropY: 62, cropW: 27, cropH: 36 }));
      if (mode === "916") {
        if (subMode === "fullscreen") applyFullscreenPreset(FULLSCREEN_PRESETS[2]);
      }
      setCameraDetected(true);
      setDetecting(false);
      pushHistory();
    }, 1100);
  };

  const autoAjustar = () => {
    if (mode !== "916") setMode("916");
    applyLayout(subMode === "free" ? "fullscreen" : subMode);
    if (!cameraDetected) detectCamera();
    pushHistory();
  };

  /* ---------------- extra layers (text / image) ---------------- */
  const addTextLayer = () => {
    const id = "text-" + Date.now();
    const layer = { id, type: "text", text: "Seu texto aqui", x: 10, y: 84, w: 80, h: 9, fontSize: 64, color: "#ffffff" };
    setExtraLayers((l) => [...l, layer]);
    setLayerOrder((o) => [...o, id]);
    setSelected(id);
    pushHistory();
  };

  const addImageLayer = (file) => {
    const id = "img-" + Date.now();
    const src = URL.createObjectURL(file);
    const layer = { id, type: "image", src, x: 30, y: 40, w: 40, h: 20 };
    setExtraLayers((l) => [...l, layer]);
    setLayerOrder((o) => [...o, id]);
    setSelected(id);
    pushHistory();
  };

  const addShapeLayer = () => {
    const id = "shape-" + Date.now();
    // Útil pra cobrir algo gravado no vídeo original (ex. um logo/HUD do
    // jogo) com uma caixa sólida colorida, posicionável como qualquer
    // outra camada.
    const layer = { id, type: "shape", color: "#0a0a0f", x: 30, y: 6, w: 40, h: 10 };
    setExtraLayers((l) => [...l, layer]);
    setLayerOrder((o) => [...o, id]);
    setSelected(id);
    pushHistory();
  };

  useEffect(() => {
    extraLayers.forEach((l) => {
      if (l.type === "image" && !imgCache.current[l.id]) {
        const img = new Image();
        img.src = l.src;
        imgCache.current[l.id] = img;
      }
    });
  }, [extraLayers]);

  const updateExtraLayer = (id, patch) => {
    setExtraLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };
  const removeExtraLayer = (id) => {
    setExtraLayers((ls) => ls.filter((l) => l.id !== id));
    setLayerOrder((o) => o.filter((x) => x !== id));
    if (selected === id) setSelected("camera");
    pushHistory();
  };
  const duplicateExtraLayer = (id) => {
    const l = extraLayers.find((x) => x.id === id);
    if (!l) return;
    const nid = l.type + "-" + Date.now();
    const copy = { ...l, id: nid, x: clamp(l.x + 4, 0, 100 - l.w), y: clamp(l.y + 4, 0, 100 - l.h) };
    setExtraLayers((ls) => [...ls, copy]);
    setLayerOrder((o) => [...o, nid]);
    setSelected(nid);
    pushHistory();
  };
  const moveLayer = (id, dir) => {
    setLayerOrder((o) => {
      const i = o.indexOf(id);
      const j = dir === "up" ? i + 1 : i - 1;
      if (j < 0 || j >= o.length) return o;
      const copy = [...o];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  };
  const toggleHidden = (id) => setHiddenMap((m) => ({ ...m, [id]: !m[id] }));
  const toggleLocked = (id) => setLockedMap((m) => ({ ...m, [id]: !m[id] }));

  /* ---------------- draw loop ---------------- */
  useEffect(() => {
    if (stage !== "editor") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (mode === "original") { canvas.width = 1280; canvas.height = 720; }
    else { canvas.width = CANVAS_W; canvas.height = CANVAS_H; }
  }, [mode, stage]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current, video = videoRef.current;
    if (!canvas || !video || video.readyState < 2) return;
    const ctx = canvas.getContext("2d");
    const s = stateRef.current;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    // Mini preview do frame bruto (sem corte), usado no seletor visual de
    // região de câmera/gameplay no painel de propriedades.
    const miniCanvas = miniCanvasRef.current;
    if (miniCanvas) {
      if (miniCanvas.width !== vw || miniCanvas.height !== vh) {
        miniCanvas.width = vw; miniCanvas.height = vh;
      }
      miniCanvas.getContext("2d").drawImage(video, 0, 0, vw, vh);
    }

    if (s.mode === "original") {
      const srcA = vw / vh, dstA = W / H;
      let dw, dh;
      if (srcA > dstA) { dw = W; dh = W / srcA; } else { dh = H; dw = H * srcA; }
      ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
      return;
    }

    const drawVideoBox = (box) => {
      const sx = (box.cropX / 100) * vw, sy = (box.cropY / 100) * vh;
      const sw = (box.cropW / 100) * vw, sh = (box.cropH / 100) * vh;
      const dx = (box.x / 100) * W, dy = (box.y / 100) * H;
      const dw = (box.w / 100) * W, dh = (box.h / 100) * H;
      ctx.save();
      if (box.rotation) {
        ctx.translate(dx + dw / 2, dy + dh / 2);
        ctx.rotate((box.rotation * Math.PI) / 180);
        ctx.translate(-(dx + dw / 2), -(dy + dh / 2));
      }
      ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
      ctx.restore();
    };

    s.layerOrder.forEach((id) => {
      if (s.hiddenMap[id]) return;
      if (id === "gameplay") drawVideoBox(s.gameplay);
      else if (id === "camera") drawVideoBox(s.camera);
      else {
        const l = s.extraLayers.find((x) => x.id === id);
        if (!l) return;
        const dx = (l.x / 100) * W, dy = (l.y / 100) * H, dw = (l.w / 100) * W, dh = (l.h / 100) * H;
        if (l.type === "text") {
          ctx.save();
          ctx.fillStyle = l.color || "#fff";
          ctx.font = `700 ${l.fontSize}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0,0,0,.6)";
          ctx.shadowBlur = 10;
          ctx.fillText(l.text, dx + dw / 2, dy + dh / 2, dw);
          ctx.restore();
        } else if (l.type === "image") {
          const img = imgCache.current[l.id];
          if (img && img.complete && img.naturalWidth) ctx.drawImage(img, dx, dy, dw, dh);
        } else if (l.type === "shape") {
          ctx.fillStyle = l.color || "#0a0a0f";
          ctx.fillRect(dx, dy, dw, dh);
        }
      }
    });
  }, []);

  useEffect(() => {
    if (stage !== "editor") return;
    let raf;
    const loop = () => { drawFrame(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [stage, drawFrame]);

  /* ---------------- scrubber ---------------- */
  const onScrub = (t) => {
    setCurrentTime(t);
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  /* ---------------- export ---------------- */
  const pickMime = () => {
    const opts = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    for (const o of opts) if (window.MediaRecorder && MediaRecorder.isTypeSupported(o)) return o;
    return "";
  };

  const runExport = async () => {
    setExportErr(""); setExportResult(null);
    const video = videoRef.current;
    if (!video) return;
    if (!video.captureStream) {
      setExportErr("Seu navegador não suporta gravação em tempo real (captureStream). Tente Chrome ou Edge atualizados.");
      return;
    }
    const [w, h] = exportRes === "original"
      ? (mode === "original" ? [video.videoWidth, video.videoHeight] : [1080, 1920])
      : exportRes.split("x").map(Number);

    const exCanvas = document.createElement("canvas");
    exCanvas.width = w; exCanvas.height = h;
    exportCanvasRef.current = exCanvas;
    const ctx = exCanvas.getContext("2d");

    setExporting(true);
    setExportProgress(0);

    video.pause();
    video.currentTime = trimStart;
    await new Promise((res) => setTimeout(res, 150));

    const canvasStream = exCanvas.captureStream(30);
    try {
      const mediaStream = video.captureStream();
      mediaStream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));
    } catch (e) { /* sem áudio disponível */ }

    const mime = pickMime();
    let recorder;
    try {
      recorder = new MediaRecorder(canvasStream, mime ? { mimeType: mime } : undefined);
    } catch (e) {
      setExportErr("Não foi possível iniciar a gravação neste navegador.");
      setExporting(false);
      return;
    }
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      setExportResult({ url, size: blob.size });
      setExporting(false);
      video.pause();
    };

    let raf;
    const s = stateRef.current;
    const drawExportFrame = () => {
      const vw = video.videoWidth, vh = video.videoHeight;
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
      if (s.mode === "original") {
        const srcA = vw / vh, dstA = w / h;
        let dw, dh;
        if (srcA > dstA) { dw = w; dh = w / srcA; } else { dh = h; dw = h * srcA; }
        ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
      } else {
        const drawBox = (box) => {
          const sx = (box.cropX / 100) * vw, sy = (box.cropY / 100) * vh;
          const sw = (box.cropW / 100) * vw, sh = (box.cropH / 100) * vh;
          const dx = (box.x / 100) * w, dy = (box.y / 100) * h;
          const dw = (box.w / 100) * w, dh = (box.h / 100) * h;
          ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
        };
        s.layerOrder.forEach((id) => {
          if (s.hiddenMap[id]) return;
          if (id === "gameplay") drawBox(s.gameplay);
          else if (id === "camera") drawBox(s.camera);
          else {
            const l = s.extraLayers.find((x) => x.id === id);
            if (!l) return;
            const dx = (l.x / 100) * w, dy = (l.y / 100) * h, dw = (l.w / 100) * w, dh = (l.h / 100) * h;
            if (l.type === "text") {
              ctx.save();
              ctx.fillStyle = l.color || "#fff";
              ctx.font = `700 ${(l.fontSize / 1920) * h}px system-ui, sans-serif`;
              ctx.textAlign = "center"; ctx.textBaseline = "middle";
              ctx.fillText(l.text, dx + dw / 2, dy + dh / 2, dw);
              ctx.restore();
            } else if (l.type === "image") {
              const img = imgCache.current[l.id];
              if (img && img.complete) ctx.drawImage(img, dx, dy, dw, dh);
            } else if (l.type === "shape") {
              ctx.fillStyle = l.color || "#0a0a0f";
              ctx.fillRect(dx, dy, dw, dh);
            }
          }
        });
      }
      const p = clamp((video.currentTime - trimStart) / Math.max(0.01, trimEnd - trimStart), 0, 1);
      setExportProgress(p);
      if (video.currentTime < trimEnd && !video.ended) raf = requestAnimationFrame(drawExportFrame);
      else { recorder.stop(); cancelAnimationFrame(raf); }
    };

    recorder.start();
    await video.play();
    raf = requestAnimationFrame(drawExportFrame);
  };

  const closeExport = () => {
    setExportOpen(false); setExportResult(null); setExportErr(""); setExporting(false);
  };

  /* ---------------- selected box helpers ---------------- */
  const selectedBox = selected === "camera" ? camera : selected === "gameplay" ? gameplay : extraLayers.find((l) => l.id === selected);
  const setSelectedBox = (patch) => {
    if (selected === "camera") setCamera((c) => ({ ...c, ...patch }));
    else if (selected === "gameplay") setGameplay((g) => ({ ...g, ...patch }));
    else updateExtraLayer(selected, patch);
  };

  /* =========================================================================== */
  /*                                   RENDER                                    */
  /* =========================================================================== */

  const fontHead = { fontFamily: "'Space Grotesk', system-ui, sans-serif" };

  if (stage === "import") {
    return (
      <div className="min-h-screen w-full bg-neutral-950 text-neutral-200 flex flex-col">
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap');`}</style>
        <header className="flex items-center gap-2 px-6 py-5 border-b border-neutral-900">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
            <Scissors size={16} className="text-white" />
          </div>
          <span style={fontHead} className="font-semibold text-lg tracking-tight">Kick Clip Editor</span>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
          <div className="max-w-xl w-full text-center mb-10">
            <h1 style={fontHead} className="text-4xl font-semibold mb-3 tracking-tight">
              Transforme clipes da Kick em cortes verticais
            </h1>
            <p className="text-neutral-400 text-sm leading-relaxed">
              Cole o link do clipe, posicione gameplay e câmera manualmente, e exporte em 9:16 — sem login, sem marca d'água.
            </p>
          </div>

          <div className="max-w-xl w-full bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
            <label className="block text-xs font-medium text-neutral-400 mb-2">Link do clipe da Kick</label>
            <div className="flex items-center gap-2 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 mb-4 focus-within:border-violet-600">
              <Link2 size={16} className="text-neutral-500 shrink-0" />
              <input
                value={clipUrl}
                onChange={(e) => setClipUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLoadClip()}
                placeholder="https://kick.com/streamer/clips/xxxxxxxx"
                className="bg-transparent outline-none text-sm w-full placeholder:text-neutral-600"
              />
            </div>

            <input
              ref={importFileRef} type="file" accept="video/*" className="hidden"
              onChange={(e) => handleFilePicked(e.target.files?.[0])}
            />

            {importError && <p className="text-xs text-rose-400 mb-3">{importError}</p>}

            <button
              onClick={handleLoadClip}
              disabled={resolving}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-70 text-white font-medium rounded-xl py-3 transition-colors flex items-center justify-center gap-2"
            >
              {resolving ? <Loader2 size={16} className="animate-spin" /> : null}
              {resolving ? "Buscando clipe…" : "Carregar Clip"}
            </button>

            <p className="text-[11px] text-neutral-600 mt-4 leading-relaxed flex gap-1.5">
              <Info size={13} className="shrink-0 mt-0.5" />
              O Kick Clip Editor busca o vídeo automaticamente pelo link, sem exigir login. Se algum clipe específico não carregar, você pode testar com um arquivo de vídeo seu enquanto isso é ajustado.
            </p>
            <button
              onClick={() => importFileRef.current?.click()}
              className="text-[11px] text-neutral-600 hover:text-violet-400 underline underline-offset-2 mt-2"
            >
              Selecionar um arquivo de vídeo manualmente
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-200 flex flex-col select-none">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap');`}</style>
      <video ref={videoRef} className="hidden" onLoadedMetadata={onEditorMeta} playsInline />

      {/* top bar */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-900 bg-neutral-950">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center">
            <Scissors size={14} className="text-white" />
          </div>
          <span style={fontHead} className="font-semibold text-sm tracking-tight">Kick Clip Editor</span>
          {meta.width > 0 && (
            <span className="hidden md:inline-flex items-center gap-2 text-[11px] font-mono text-neutral-500 ml-3 pl-3 border-l border-neutral-800">
              {meta.width}×{meta.height} · {fmtTime(meta.duration)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <IconBtn title="Desfazer (Ctrl+Z)" onClick={undo} disabled={!past.length}><Undo2 size={16} /></IconBtn>
          <IconBtn title="Refazer (Ctrl+Shift+Z)" onClick={redo} disabled={!future.length}><Redo2 size={16} /></IconBtn>
          <div className="w-px h-5 bg-neutral-800 mx-1" />
          <button
            onClick={autoAjustar}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-900 border border-neutral-800 hover:border-violet-600 text-neutral-200"
          >
            <Wand2 size={13} className="text-violet-400" /> Auto ajustar
          </button>
        </div>
        <button
          onClick={() => setExportOpen(true)}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white"
        >
          <Download size={15} /> Exportar
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* left/center: preview + controls + timeline */}
        <div className="flex-1 flex flex-col items-center overflow-y-auto px-6 py-5 gap-4">

          {/* mode + submode controls */}
          <div className="flex flex-wrap items-center gap-2">
            <PresetBtn label="Original" active={mode === "original"} onClick={() => setMainMode("original")} />
            <PresetBtn label="9:16" active={mode === "916"} onClick={() => setMainMode("916")} />
            {mode === "916" && (
              <>
                <div className="w-px h-5 bg-neutral-800 mx-1" />
                <PresetBtn label="Tela cheia" active={subMode === "fullscreen"} onClick={() => { applyLayout("fullscreen"); pushHistory(); }} />
                <PresetBtn label="Empilhado" active={subMode === "stacked"} onClick={() => { applyLayout("stacked"); pushHistory(); }} />
                <PresetBtn label="Livre" active={subMode === "free"} onClick={() => { applyLayout("free"); pushHistory(); }} />
              </>
            )}
          </div>

          {/* sub-presets */}
          {mode === "916" && subMode === "fullscreen" && (
            <div className="flex flex-wrap items-center gap-2">
              {FULLSCREEN_PRESETS.map((p) => (
                <PresetBtn key={p.id} label={p.label} onClick={() => applyFullscreenPreset(p)} />
              ))}
              <PresetBtn label="Personalizado" onClick={() => {}} />
            </div>
          )}
          {mode === "916" && subMode === "stacked" && (
            <div className="flex flex-wrap items-center gap-2">
              {STACKED_PRESETS.map((p) => (
                <PresetBtn key={p.id} label={p.label} onClick={() => applyStackedPreset(p)} />
              ))}
              <PresetBtn label="Personalizado" onClick={() => {}} />
            </div>
          )}

          {/* camera detection row */}
          {mode === "916" && (
            <div className="flex flex-wrap items-center gap-3 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2">
              <button
                onClick={detectCamera}
                disabled={detecting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-950 border border-neutral-800 hover:border-violet-600 disabled:opacity-60"
              >
                {detecting ? <Loader2 size={13} className="animate-spin text-violet-400" /> : <Crosshair size={13} className="text-violet-400" />}
                {detecting ? "Analisando vídeo…" : "Detectar câmera automaticamente"}
              </button>
              <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer">
                <input type="checkbox" checked={followCam} onChange={(e) => setFollowCam(e.target.checked)} className="accent-violet-500" />
                Seguir câmera automaticamente
              </label>
              {cameraDetected && !detecting && (
                <span className="flex items-center gap-1 text-[11px] text-emerald-400"><Check size={12} /> câmera detectada — ajuste livremente</span>
              )}
            </div>
          )}

          {/* preview */}
          <div
            ref={previewWrapRef}
            onClick={() => setSelected(null)}
            className="relative bg-black rounded-2xl overflow-hidden border border-neutral-800 mx-auto"
            style={{
              aspectRatio: mode === "original" ? "16/9" : "9/16",
              width: mode === "original" ? "min(70vw, 760px)" : "min(38vw, 420px)",
              maxHeight: "58vh",
            }}
          >
            <canvas ref={canvasRef} className="w-full h-full block" />
            {mode !== "original" && (
              <div className="absolute inset-0">
                {layerOrder.map((id) => {
                  if (id === "gameplay") {
                    return (
                      <LayerBox key="gameplay" id="gameplay" box={gameplay} color="#22d3ee" label="Gameplay"
                        selected={selected === "gameplay"} locked={!!lockedMap.gameplay} hidden={!!hiddenMap.gameplay}
                        onSelect={setSelected} onChange={setGameplay} onCommit={pushHistory} containerRef={previewWrapRef} />
                    );
                  }
                  if (id === "camera") {
                    return (
                      <LayerBox key="camera" id="camera" box={camera} color="#a855f7" label="Câmera"
                        selected={selected === "camera"} locked={!!lockedMap.camera || followCam} hidden={!!hiddenMap.camera}
                        onSelect={setSelected} onChange={setCamera} onCommit={pushHistory} containerRef={previewWrapRef} />
                    );
                  }
                  const l = extraLayers.find((x) => x.id === id);
                  if (!l) return null;
                  return (
                    <LayerBox key={id} id={id} box={l} color={l.type === "text" ? "#fbbf24" : l.type === "shape" ? "#f87171" : "#34d399"}
                      label={l.type === "text" ? "Texto" : l.type === "shape" ? "Caixa" : "Overlay"}
                      selected={selected === id} locked={!!lockedMap[id]} hidden={!!hiddenMap[id]}
                      onSelect={setSelected} onChange={(b) => updateExtraLayer(id, b)} onCommit={pushHistory} containerRef={previewWrapRef} />
                  );
                })}
              </div>
            )}
          </div>

          {/* quick actions for selected */}
          {mode !== "916" ? null : (selected === "camera" || selected === "gameplay") && (
            <div className="flex items-center gap-2">
              <PresetBtn label="Centralizar" onClick={() => centerLayer(selected)} />
              <PresetBtn label="Preencher tela" onClick={() => fillLayer(selected)} />
              <PresetBtn label="Resetar" onClick={() => resetLayer(selected)} />
            </div>
          )}

          {/* timeline */}
          <div className="w-full max-w-3xl bg-neutral-900 border border-neutral-800 rounded-2xl p-4 mt-1">
            <div className="flex items-center gap-3 mb-3">
              <button onClick={togglePlay} className="w-9 h-9 rounded-full bg-violet-600 hover:bg-violet-500 flex items-center justify-center text-white shrink-0">
                {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
              </button>
              <span className="text-xs font-mono text-neutral-400 w-10">{fmtTime(currentTime)}</span>
              <input
                type="range" min={0} max={duration || 0} step={0.01} value={currentTime}
                onMouseDown={() => setScrubbing(true)}
                onMouseUp={() => setScrubbing(false)}
                onChange={(e) => onScrub(parseFloat(e.target.value))}
                className="flex-1 accent-violet-500 h-1.5"
              />
              <span className="text-xs font-mono text-neutral-400 w-10">{fmtTime(duration)}</span>
              <button onClick={() => setMuted((m) => !m)} className="text-neutral-400 hover:text-white">
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range" min={0} max={1} step={0.01} value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-20 accent-violet-500 h-1.5"
              />
            </div>

            {/* trim bar */}
            <div className="relative h-6 bg-neutral-950 rounded-lg border border-neutral-800">
              <div
                className="absolute top-0 bottom-0 bg-violet-600/30 border-l-2 border-r-2 border-violet-500 rounded"
                style={{
                  left: `${(trimStart / (duration || 1)) * 100}%`,
                  width: `${((trimEnd - trimStart) / (duration || 1)) * 100}%`,
                }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white/70"
                style={{ left: `${(currentTime / (duration || 1)) * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTrimStart(clamp(currentTime, 0, trimEnd - 0.2))}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-violet-600"
                >
                  <Scissors size={12} /> Cortar início
                </button>
                <button
                  onClick={() => setTrimEnd(clamp(currentTime, trimStart + 0.2, duration))}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-violet-600"
                >
                  <Scissors size={12} /> Cortar final
                </button>
              </div>
              <span className="text-[11px] text-neutral-500 font-mono">
                corte: {fmtTime(trimStart)} — {fmtTime(trimEnd)} ({fmtTime(trimEnd - trimStart)})
              </span>
            </div>
          </div>
        </div>

        {/* right panel */}
        <aside className="w-80 shrink-0 border-l border-neutral-900 bg-neutral-950 overflow-y-auto flex flex-col">
          <div className="p-4 border-b border-neutral-900">
            <div className="flex items-center gap-2 mb-3">
              <Settings2 size={14} className="text-violet-400" />
              <span style={fontHead} className="text-xs font-semibold tracking-wide text-neutral-300">Propriedades</span>
            </div>

            {mode !== "916" && <p className="text-xs text-neutral-500">Ative o modo 9:16 para editar câmera e gameplay.</p>}

            {mode === "916" && !selectedBox && (
              <p className="text-xs text-neutral-500">Selecione a câmera ou o gameplay no preview para editar.</p>
            )}

            {mode === "916" && selectedBox && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-neutral-500 mb-2">
                  {selected === "camera" ? "Câmera" : selected === "gameplay" ? "Gameplay" : selectedBox.type === "text" ? "Texto" : selectedBox.type === "shape" ? "Caixa sólida" : "Overlay"}
                </div>

                {selectedBox.type === "text" && (
                  <input
                    value={selectedBox.text}
                    onChange={(e) => setSelectedBox({ text: e.target.value })}
                    onBlur={pushHistory}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-sm mb-3 outline-none focus:border-violet-600"
                  />
                )}

                {selectedBox.type === "shape" && (
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="color"
                      value={selectedBox.color}
                      onChange={(e) => setSelectedBox({ color: e.target.value })}
                      onBlur={pushHistory}
                      className="w-9 h-9 rounded-lg border border-neutral-800 bg-transparent cursor-pointer"
                    />
                    <span className="text-xs text-neutral-500">Cor da caixa — use pra cobrir algo do vídeo original</span>
                  </div>
                )}

                <Field label="Posição X" value={selectedBox.x} min={0} max={100} onChange={(v) => setSelectedBox({ x: v })} onCommit={pushHistory} />
                <Field label="Posição Y" value={selectedBox.y} min={0} max={100} onChange={(v) => setSelectedBox({ y: v })} onCommit={pushHistory} />
                <Field label="Largura" value={selectedBox.w} min={5} max={100} onChange={(v) => setSelectedBox({ w: v })} onCommit={pushHistory} />
                <Field label="Altura" value={selectedBox.h} min={5} max={100} onChange={(v) => setSelectedBox({ h: v })} onCommit={pushHistory} />

                {(selected === "camera" || selected === "gameplay") && (
                  <>
                    <div className="h-px bg-neutral-900 my-3" />
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">Selecionar região no vídeo original</div>
                    <p className="text-[11px] text-neutral-600 mb-2">Arraste a caixa abaixo para escolher qual parte do vídeo aparece aqui — isso é diferente de mover a caixa no preview, que só muda a posição na tela.</p>
                    <div
                      ref={miniWrapRef}
                      className="relative rounded-lg overflow-hidden border border-neutral-800 bg-black mb-3"
                      style={{ aspectRatio: `${meta.width || 16} / ${meta.height || 9}` }}
                    >
                      <canvas ref={miniCanvasRef} className="w-full h-full block" />
                      <div className="absolute inset-0">
                        <LayerBox
                          id="__crop__"
                          box={{ x: selectedBox.cropX, y: selectedBox.cropY, w: selectedBox.cropW, h: selectedBox.cropH }}
                          color={selected === "camera" ? "#a855f7" : "#22d3ee"}
                          label="Região"
                          selected locked={false} hidden={false}
                          onSelect={() => {}}
                          onChange={(b) => setSelectedBox({ cropX: b.x, cropY: b.y, cropW: b.w, cropH: b.h })}
                          onCommit={pushHistory}
                          containerRef={miniWrapRef}
                        />
                      </div>
                    </div>
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500 mb-2">Zoom / Crop (fonte)</div>
                    <Field label="Zoom do recorte" value={10000 / Math.max(1, selectedBox.cropW)} min={80} max={400}
                      onChange={(v) => {
                        const nw = clamp(10000 / v, 5, 100), nh = clamp(nw * (selectedBox.cropH / selectedBox.cropW), 5, 100);
                        setSelectedBox({
                          cropW: nw, cropH: nh,
                          cropX: clamp(selectedBox.cropX + (selectedBox.cropW - nw) / 2, 0, 100 - nw),
                          cropY: clamp(selectedBox.cropY + (selectedBox.cropH - nh) / 2, 0, 100 - nh),
                        });
                      }} onCommit={pushHistory} />
                    <Field label="Crop X" value={selectedBox.cropX} min={0} max={100 - selectedBox.cropW} onChange={(v) => setSelectedBox({ cropX: v })} onCommit={pushHistory} />
                    <Field label="Crop Y" value={selectedBox.cropY} min={0} max={100 - selectedBox.cropH} onChange={(v) => setSelectedBox({ cropY: v })} onCommit={pushHistory} />
                  </>
                )}

                <Field label="Rotação" value={selectedBox.rotation || 0} min={-45} max={45} unit="°" onChange={(v) => setSelectedBox({ rotation: v })} onCommit={pushHistory} />

                <div className="flex items-center gap-2 mt-2">
                  {(selected === "camera" || selected === "gameplay") ? (
                    <>
                      <button onClick={() => centerLayer(selected)} className="flex-1 text-xs py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-violet-600">Centralizar</button>
                      <button onClick={() => fillLayer(selected)} className="flex-1 text-xs py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-violet-600">Preencher</button>
                      <button onClick={() => resetLayer(selected)} className="flex-1 text-xs py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-violet-600"><RotateCcw size={12} className="inline" /></button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => duplicateExtraLayer(selected)} className="flex-1 text-xs py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-violet-600 flex items-center justify-center gap-1"><Copy size={12} /> Duplicar</button>
                      <button onClick={() => removeExtraLayer(selected)} className="flex-1 text-xs py-1.5 rounded-lg bg-neutral-900 border border-rose-900/60 text-rose-400 hover:border-rose-600 flex items-center justify-center gap-1"><Trash2 size={12} /> Remover</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* overlays add */}
          <div className="p-4 border-b border-neutral-900">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500 mb-2">Adicionar</div>
            <div className="flex gap-2">
              <button onClick={addTextLayer} className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-violet-600">
                <Type size={13} /> Texto
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-violet-600">
                <ImageIcon size={13} /> Imagem
              </button>
              <button onClick={addShapeLayer} title="Útil pra cobrir um logo ou texto gravado no vídeo" className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-violet-600">
                <SquareStack size={13} /> Caixa
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && addImageLayer(e.target.files[0])} />
            </div>
          </div>

          {/* layers panel */}
          <div className="p-4 flex-1">
            <div className="flex items-center gap-2 mb-2">
              <LayersIcon size={14} className="text-violet-400" />
              <span style={fontHead} className="text-xs font-semibold tracking-wide text-neutral-300">Camadas</span>
            </div>
            <div className="space-y-1.5">
              {[...layerOrder].reverse().map((id) => {
                const isCam = id === "camera", isGame = id === "gameplay";
                const l = isCam ? null : isGame ? null : extraLayers.find((x) => x.id === id);
                const label = isCam ? "Câmera" : isGame ? "Gameplay" : l?.type === "text" ? (l.text || "Texto") : l?.type === "shape" ? "Caixa sólida" : "Overlay";
                const Icon = isCam ? CameraIcon : isGame ? Video : l?.type === "text" ? Type : l?.type === "shape" ? SquareStack : ImageIcon;
                const core = isCam || isGame;
                return (
                  <div key={id}
                    onClick={() => setSelected(id)}
                    className={"flex items-center gap-2 px-2 py-1.5 rounded-lg border cursor-pointer text-xs " +
                      (selected === id ? "bg-violet-600/15 border-violet-600" : "bg-neutral-900 border-neutral-800 hover:border-neutral-700")}
                  >
                    <Icon size={13} className="text-neutral-400 shrink-0" />
                    <span className="truncate flex-1">{label}</span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button onClick={(e) => { e.stopPropagation(); moveLayer(id, "up"); }} className="text-neutral-500 hover:text-white p-0.5"><ChevronUp size={12} /></button>
                      <button onClick={(e) => { e.stopPropagation(); moveLayer(id, "down"); }} className="text-neutral-500 hover:text-white p-0.5"><ChevronDown size={12} /></button>
                      {!core && <button onClick={(e) => { e.stopPropagation(); duplicateExtraLayer(id); }} className="text-neutral-500 hover:text-white p-0.5"><Copy size={12} /></button>}
                      <button onClick={(e) => { e.stopPropagation(); toggleLocked(id); }} className="text-neutral-500 hover:text-white p-0.5">
                        {lockedMap[id] ? <Lock size={12} /> : <Unlock size={12} />}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); toggleHidden(id); }} className="text-neutral-500 hover:text-white p-0.5">
                        {hiddenMap[id] ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                      {!core && <button onClick={(e) => { e.stopPropagation(); removeExtraLayer(id); }} className="text-rose-500 hover:text-rose-400 p-0.5"><Trash2 size={12} /></button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>

      {/* export modal */}
      {exportOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-4">
              <span style={fontHead} className="font-semibold">Exportar vídeo</span>
              <button onClick={closeExport} className="text-neutral-500 hover:text-white"><X size={18} /></button>
            </div>

            {!exportResult && (
              <>
                <div className="mb-4">
                  <div className="text-xs text-neutral-400 mb-2">Formato</div>
                  <div className="flex flex-col gap-1.5">
                    {[
                      { id: "custom", label: "Personalizado (como está no preview)" },
                      { id: "fullscreen", label: "Tela cheia" },
                      { id: "stacked", label: "Empilhado" },
                    ].map((f) => (
                      <label key={f.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="radio" name="fmt" className="accent-violet-500"
                          checked={f.id === "custom" ? subMode === "free" : subMode === f.id}
                          onChange={() => { if (f.id !== "custom") applyLayout(f.id); }}
                        />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="mb-5">
                  <div className="text-xs text-neutral-400 mb-2">Resolução</div>
                  <div className="flex flex-col gap-1.5">
                    {[
                      { id: "1080x1920", label: "1080 × 1920" },
                      { id: "720x1280", label: "720 × 1280" },
                      { id: "original", label: "Original" },
                    ].map((r) => (
                      <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="radio" name="res" className="accent-violet-500" checked={exportRes === r.id} onChange={() => setExportRes(r.id)} />
                        {r.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-[11px] text-neutral-500 mb-4">
                  <span>Formato: <span className="text-neutral-300">MP4*</span></span>
                  <span>Codec: <span className="text-neutral-300">H.264*</span></span>
                  <span>Áudio: <span className="text-neutral-300">AAC*</span></span>
                </div>
                <p className="text-[11px] text-neutral-600 mb-4">
                  *Esta demonstração roda 100% no navegador e grava em WebM (VP9/Opus). No backend Node.js + FFmpeg do produto final, esse arquivo é transcodificado automaticamente para MP4 H.264/AAC.
                </p>

                {exportErr && <p className="text-xs text-rose-400 mb-3">{exportErr}</p>}

                {exporting ? (
                  <div>
                    <div className="h-2 rounded-full bg-neutral-800 overflow-hidden mb-2">
                      <div className="h-full bg-violet-600 transition-all" style={{ width: `${exportProgress * 100}%` }} />
                    </div>
                    <p className="text-xs text-neutral-400 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Renderizando… {Math.round(exportProgress * 100)}%</p>
                  </div>
                ) : (
                  <button onClick={runExport} className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl py-3">
                    Iniciar exportação
                  </button>
                )}
              </>
            )}

            {exportResult && (
              <div className="text-center py-2">
                <div className="w-12 h-12 rounded-full bg-emerald-600/20 border border-emerald-600 flex items-center justify-center mx-auto mb-3">
                  <Check size={20} className="text-emerald-400" />
                </div>
                <p className="text-sm text-neutral-300 mb-1">Exportação concluída</p>
                <p className="text-xs text-neutral-500 mb-4">{(exportResult.size / 1024 / 1024).toFixed(1)} MB</p>
                <a
                  href={exportResult.url} download="kick-clip-vertical.webm"
                  className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl py-3 px-6"
                >
                  <Download size={16} /> Baixar vídeo
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
