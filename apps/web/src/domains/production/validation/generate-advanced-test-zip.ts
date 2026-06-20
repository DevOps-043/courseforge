import JSZip from "jszip";
import * as fs from "fs";
import * as path from "path";

const manifest = {
  name: "Plantilla Remotion Avanzada",
  entryPoint: "src/index.tsx",
  compositionId: "advanced-avatar-subtitles",
  remotionVersion: "4.0.474",
};

const packageJson = {
  name: "remotion-template-advanced-example",
  private: true,
  dependencies: {
    react: "^19.2.3",
    "react-dom": "^19.2.3",
    remotion: "^4.0.474",
  },
};

const entryPointContent = `import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

type AvatarPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";

type Slide = {
  index: number;
  url: string;
};

type TemplateProps = {
  slides?: Slide[];
  totalDurationInFrames?: number;
};

type Cue = {
  startFrame: number;
  endFrame: number;
  text: string;
};

type Scene = {
  startFrame: number;
  endFrame: number;
  eyebrow: string;
  title: string;
  body: string;
  avatarPosition: AvatarPosition;
  accent: string;
};

const scenes: Scene[] = [
  {
    startFrame: 0,
    endFrame: 150,
    eyebrow: "Escena 01",
    title: "Diagnostico inicial",
    body: "El avatar inicia como guia lateral mientras el contenido principal establece el problema.",
    avatarPosition: "bottom-right",
    accent: "#00D4B3",
  },
  {
    startFrame: 150,
    endFrame: 300,
    eyebrow: "Escena 02",
    title: "Cambio de foco",
    body: "La composicion mueve el avatar para liberar espacio a una visualizacion de proceso.",
    avatarPosition: "top-left",
    accent: "#F4B740",
  },
  {
    startFrame: 300,
    endFrame: 450,
    eyebrow: "Escena 03",
    title: "Aplicacion guiada",
    body: "Los bloques de apoyo simulan B-roll y resaltan los pasos que debe ejecutar el estudiante.",
    avatarPosition: "bottom-left",
    accent: "#7C6BFF",
  },
  {
    startFrame: 450,
    endFrame: 600,
    eyebrow: "Escena 04",
    title: "Cierre y criterio",
    body: "El avatar vuelve al extremo opuesto y el subtitulo refuerza la evidencia esperada.",
    avatarPosition: "top-right",
    accent: "#FF6B6B",
  },
];

const subtitles: Cue[] = [
  {
    startFrame: 10,
    endFrame: 88,
    text: "Primero identificamos que decision necesita tomar el estudiante.",
  },
  {
    startFrame: 96,
    endFrame: 148,
    text: "El material visual queda al centro y el avatar acompana sin cubrirlo.",
  },
  {
    startFrame: 164,
    endFrame: 232,
    text: "Ahora movemos el avatar para abrir espacio a la secuencia de proceso.",
  },
  {
    startFrame: 240,
    endFrame: 296,
    text: "Cada cambio de posicion puede conectarse con una nueva escena pedagogica.",
  },
  {
    startFrame: 314,
    endFrame: 382,
    text: "En la practica, el estudiante sigue pasos breves y verificables.",
  },
  {
    startFrame: 390,
    endFrame: 446,
    text: "Los apoyos visuales funcionan como B-roll contextual o capturas del sistema.",
  },
  {
    startFrame: 462,
    endFrame: 540,
    text: "Cerramos con el criterio de exito y la evidencia que se debe entregar.",
  },
  {
    startFrame: 548,
    endFrame: 592,
    text: "El resultado final es una plantilla mas dinamica para QA de bundles.",
  },
];

function getActiveScene(frame: number) {
  return scenes.find((scene) => frame >= scene.startFrame && frame < scene.endFrame) || scenes[0];
}

function getActiveSubtitle(frame: number) {
  return subtitles.find((cue) => frame >= cue.startFrame && frame < cue.endFrame);
}

function getActiveSlide(frame: number, slides: Slide[], durationInFrames: number) {
  if (slides.length === 0) return null;

  const ordered = [...slides].sort((a, b) => a.index - b.index);
  const perSlideFrames = Math.max(1, Math.floor(durationInFrames / ordered.length));
  const activeIndex = Math.min(ordered.length - 1, Math.floor(frame / perSlideFrames));
  return ordered[activeIndex];
}

function avatarPositionStyle(position: AvatarPosition, progress: number): React.CSSProperties {
  const offset = interpolate(progress, [0, 1], [44, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const common: React.CSSProperties = {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: "50%",
    border: "5px solid rgba(255,255,255,0.82)",
    boxShadow: "0 24px 70px rgba(0,0,0,0.42)",
    overflow: "hidden",
    transform: \`translateY(\${offset}px)\`,
  };

  if (position === "bottom-left") return { ...common, left: 82, bottom: 86 };
  if (position === "top-left") return { ...common, left: 82, top: 74 };
  if (position === "top-right") return { ...common, right: 82, top: 74 };
  return { ...common, right: 82, bottom: 86 };
}

function Avatar({ scene }: { scene: Scene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = Math.max(0, frame - scene.startFrame);
  const entrance = spring({ frame: localFrame, fps, config: { damping: 18, stiffness: 130 } });
  const pulse = interpolate(Math.sin(frame / 8), [-1, 1], [0.96, 1.04]);

  return (
    <div style={avatarPositionStyle(scene.avatarPosition, entrance)}>
      <div
        style={{
          width: "100%",
          height: "100%",
          background: \`radial-gradient(circle at 45% 28%, #ffffff 0 9%, \${scene.accent} 10% 12%, #26313d 13% 100%)\`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 112,
            height: 112,
            borderRadius: "50%",
            background: "linear-gradient(160deg, #f8fafc, #d8e0ea)",
            transform: \`scale(\${pulse})\`,
            boxShadow: "0 0 0 18px rgba(255,255,255,0.16)",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 24,
          right: 24,
          bottom: 26,
          height: 16,
          borderRadius: 999,
          background: scene.accent,
          opacity: 0.86,
        }}
      />
    </div>
  );
}

function Subtitle({ cue }: { cue?: Cue }) {
  const frame = useCurrentFrame();

  if (!cue) return null;

  const fadeIn = interpolate(frame, [cue.startFrame, cue.startFrame + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [cue.endFrame - 10, cue.endFrame], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: 300,
        right: 300,
        bottom: 54,
        minHeight: 82,
        padding: "18px 30px",
        borderRadius: 18,
        background: "rgba(10,14,20,0.82)",
        color: "#ffffff",
        fontFamily: "system-ui, sans-serif",
        fontSize: 34,
        lineHeight: 1.22,
        textAlign: "center",
        boxShadow: "0 18px 50px rgba(0,0,0,0.34)",
        opacity: Math.min(fadeIn, fadeOut),
      }}
    >
      {cue.text}
    </div>
  );
}

function TimelineMarkers({ scene }: { scene: Scene }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
      {["Contexto", "Decision", "Practica", "Evidencia"].map((label, index) => (
        <div
          key={label}
          style={{
            height: 92,
            borderRadius: 14,
            background: index === scenes.indexOf(scene) ? scene.accent : "rgba(255,255,255,0.10)",
            color: index === scenes.indexOf(scene) ? "#081016" : "#d9e1ea",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "system-ui, sans-serif",
            fontSize: 28,
            fontWeight: 800,
          }}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

function SlideStage({ slides, scene }: { slides: Slide[]; scene: Scene }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const activeSlide = getActiveSlide(frame, slides, durationInFrames);
  const hasSlides = Boolean(activeSlide);

  return (
    <div
      style={{
        borderRadius: 22,
        background: hasSlides ? "#05070a" : \`linear-gradient(145deg, \${scene.accent} 0%, rgba(255,255,255,0.14) 56%, rgba(255,255,255,0.08) 100%)\`,
        padding: hasSlides ? 0 : 30,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.16)",
      }}
    >
      {activeSlide ? (
        <Img
          src={activeSlide.url}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      ) : (
        <>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#091018" }}>Slide / B-roll placeholder</div>
          <div style={{ color: "#091018", fontSize: 48, fontWeight: 950, lineHeight: 1 }}>
            Captura + indicadores + foco narrativo
          </div>
        </>
      )}
    </div>
  );
}

export const AdvancedAvatarSubtitles = (props: TemplateProps) => {
  const frame = useCurrentFrame();
  const scene = getActiveScene(frame);
  const cue = getActiveSubtitle(frame);
  const slides = Array.isArray(props.slides) ? props.slides : [];
  const sceneProgress = interpolate(frame, [scene.startFrame, scene.startFrame + 28], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #101820 0%, #18232f 48%, #0c1118 100%)",
        color: "white",
        fontFamily: "system-ui, sans-serif",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 46,
          borderRadius: 28,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(255,255,255,0.045)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14)",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 116,
          top: 96,
          width: 980,
          opacity: sceneProgress,
          transform: \`translateY(\${interpolate(sceneProgress, [0, 1], [28, 0])}px)\`,
        }}
      >
        <div style={{ color: scene.accent, fontSize: 30, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>
          {scene.eyebrow}
        </div>
        <h1 style={{ margin: "18px 0 18px", fontSize: 86, lineHeight: 0.95, letterSpacing: 0 }}>
          {scene.title}
        </h1>
        <p style={{ margin: 0, color: "#cbd5e1", fontSize: 34, lineHeight: 1.35, maxWidth: 880 }}>
          {scene.body}
        </p>
      </div>

      <div
        style={{
          position: "absolute",
          left: 116,
          right: 116,
          top: 520,
          height: 270,
          display: "grid",
          gridTemplateColumns: "1.1fr 0.9fr",
          gap: 26,
        }}
      >
        <div style={{ borderRadius: 22, background: "rgba(255,255,255,0.10)", padding: 28 }}>
          <TimelineMarkers scene={scene} />
          <div style={{ marginTop: 24, height: 64, borderRadius: 999, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
            <div
              style={{
                width: \`\${Math.round((frame / 600) * 100)}%\`,
                height: "100%",
                background: scene.accent,
              }}
            />
          </div>
        </div>
        <SlideStage slides={slides} scene={scene} />
      </div>

      <Avatar scene={scene} />
      <Subtitle cue={cue} />
    </AbsoluteFill>
  );
};

export const MyComposition = AdvancedAvatarSubtitles;
`;

const readmeContent = `# Remotion advanced example

Bundle de ejemplo para validar plantillas externas de Courseforge.

Incluye:

- Manifest requerido por Courseforge.
- Composicion React/Remotion autocontenida.
- Subtitulos temporizados.
- Cambios de posicion de avatar por escena.
- Placeholder visual para B-roll y progreso narrativo.

Este ZIP esta pensado para validacion estatica y revision humana. En la V1 de
bundles externos Courseforge no ejecuta codigo del ZIP.
`;

async function generateZip() {
  const zip = new JSZip();

  zip.file("courseforge-remotion-template.json", JSON.stringify(manifest, null, 2));
  zip.file("package.json", JSON.stringify(packageJson, null, 2));
  zip.file("README.md", readmeContent);
  zip.file("src/index.tsx", entryPointContent);

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const outputPath = path.resolve(process.cwd(), "remotion-template-advanced-example.zip");

  fs.writeFileSync(outputPath, buffer);
  console.log(`ZIP avanzado creado en: ${outputPath}`);
}

generateZip().catch((error) => {
  console.error(error);
  process.exit(1);
});
