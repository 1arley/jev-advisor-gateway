import {
  Composition,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const C = {
  bg: "#080D18",
  panel: "#111A2A",
  line: "#28374C",
  text: "#F4F7FB",
  muted: "#9BAAC0",
  cyan: "#65D9E8",
  lime: "#B6F27C",
  amber: "#F6C66A",
};

const enter = (frame: number, start: number, fps: number) =>
  spring({
    frame: frame - start,
    fps,
    config: { damping: 22, stiffness: 130, mass: 0.8 },
  });

const Card: React.FC<{
  x: number;
  y: number;
  w: number;
  title: string;
  body: string;
  accent: string;
  opacity?: number;
}> = ({ x, y, w, title, body, accent, opacity = 1 }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: w,
      height: 176,
      boxSizing: "border-box",
      border: `1px solid ${C.line}`,
      borderRadius: 20,
      background: C.panel,
      padding: "24px 26px",
      opacity,
    }}
  >
    <div
      style={{
        width: 10,
        height: 10,
        borderRadius: 8,
        background: accent,
        marginBottom: 18,
        boxShadow: `0 0 18px ${accent}`,
      }}
    />
    <div
      style={{
        color: C.text,
        fontSize: 25,
        fontWeight: 650,
        letterSpacing: -0.5,
      }}
    >
      {title}
    </div>
    <div
      style={{ color: C.muted, fontSize: 17, marginTop: 10, lineHeight: 1.45 }}
    >
      {body}
    </div>
  </div>
);

const Connector: React.FC<{
  x: number;
  y: number;
  w: number;
  visible: number;
  color: string;
}> = ({ x, y, w, visible, color }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: w * visible,
      height: 2,
      background: color,
      boxShadow: `0 0 14px ${color}`,
    }}
  />
);

const FlowVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleIn = enter(frame, 0, fps);
  const flowIn = enter(frame, 34, fps);
  const jevIn = enter(frame, 82, fps);
  const returnIn = enter(frame, 150, fps);
  const advisorIn = enter(frame, 245, fps);
  const finishIn = enter(frame, 365, fps);
  const fade = interpolate(frame, [395, 420], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const showFlow = interpolate(flowIn, [0, 1], [0, 1]);
  const scale = (v: number) => 0.96 + v * 0.04;
  const activeChoice = frame >= 106 && frame < 182;
  const showFailOpen = frame >= 182 && frame < 245;
  const showAdvisor = frame >= 245 && frame < 365;
  const footer = frame >= 365;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `radial-gradient(ellipse at 50% 40%, #142239 0%, ${C.bg} 68%)`,
        color: C.text,
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 76,
          top: 53,
          color: C.cyan,
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: 3.2,
        }}
      >
        JEV ADVISOR GATEWAY
      </div>
      <div
        style={{
          position: "absolute",
          left: 76,
          top: 98,
          width: 1120,
          fontSize: 43,
          lineHeight: 1.12,
          fontWeight: 650,
          letterSpacing: -1.6,
          opacity: titleIn,
          transform: `translateY(${(1 - titleIn) * 12}px)`,
        }}
      >
        Your agent owns the work.
        <span style={{ color: C.cyan }}> Jev routes tool choices.</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: 80,
          top: 296,
          transform: `scale(${scale(flowIn)})`,
          opacity: showFlow,
        }}
      >
        <Card
          x={0}
          y={0}
          w={250}
          title="Coding agent"
          body="Your session and login"
          accent={C.cyan}
        />
        <Card
          x={365}
          y={0}
          w={250}
          title="Local gateway"
          body="Routes tool requests"
          accent={C.lime}
        />
        <Card
          x={730}
          y={0}
          w={250}
          title="Jev"
          body="Chooses a tool, or passes"
          accent={C.amber}
        />
        <Connector x={270} y={88} w={90} visible={showFlow} color={C.cyan} />
        <Connector x={635} y={88} w={90} visible={showFlow} color={C.lime} />
      </div>
      {activeChoice && (
        <div
          style={{
            position: "absolute",
            left: 810,
            top: 505,
            color: C.lime,
            fontSize: 20,
            fontWeight: 650,
            opacity: jevIn,
          }}
        >
          Decision: read_file{" "}
          <span style={{ color: C.muted, fontWeight: 400 }}>
            {" "}
            · confidence clears threshold
          </span>
        </div>
      )}
      {frame >= 150 && frame < 245 && (
        <div
          style={{
            position: "absolute",
            left: 80,
            top: 520,
            opacity: returnIn,
            fontSize: 19,
            color: C.muted,
          }}
        >
          The session model handles open-ended arguments and the final answer.
        </div>
      )}
      {showFailOpen && (
        <div
          style={{
            position: "absolute",
            left: 80,
            top: 570,
            borderLeft: `3px solid ${C.amber}`,
            paddingLeft: 16,
            color: C.text,
            fontSize: 21,
            opacity: 1,
          }}
        >
          If Jev is unavailable or unsure, the request passes through.
        </div>
      )}
      {showAdvisor && (
        <div
          style={{
            position: "absolute",
            left: 80,
            top: 500,
            width: 1040,
            padding: "23px 27px",
            border: `1px solid ${C.line}`,
            borderRadius: 16,
            background: "#111a2add",
            opacity: advisorIn,
            transform: `translateY(${(1 - advisorIn) * 10}px)`,
          }}
        >
          <div
            style={{
              color: C.amber,
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            OPTIONAL · READ-ONLY
          </div>
          <div style={{ fontSize: 23, marginTop: 12 }}>
            On selected turns, an advisor adds a note.
          </div>
          <div style={{ fontSize: 18, color: C.muted, marginTop: 8 }}>
            Your main agent decides whether to use it. It never runs tools.
          </div>
        </div>
      )}
      {footer && (
        <div
          style={{
            position: "absolute",
            left: 80,
            top: 520,
            fontSize: 25,
            fontWeight: 600,
            color: C.text,
            opacity: finishIn,
          }}
        >
          Loopback by default. Fail-open by design.{" "}
          <span style={{ color: C.cyan }}>You stay in control.</span>
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left: 76,
          bottom: 38,
          color: C.muted,
          fontSize: 13,
          letterSpacing: 1.6,
          opacity: fade,
        }}
      >
        CODEX · CLAUDE CODE · OPENCODE · KILO · GEMINI · DEVIN
      </div>
      <div
        style={{
          position: "absolute",
          right: 78,
          bottom: 38,
          width: 145,
          height: 3,
          background: C.line,
        }}
      >
        <div
          style={{
            width: `${Math.min(100, (frame / 420) * 100)}%`,
            height: "100%",
            background: C.cyan,
          }}
        />
      </div>
    </div>
  );
};

export const MyComposition = () => (
  <Composition
    id="GatewayOverview"
    component={FlowVideo}
    durationInFrames={420}
    fps={30}
    width={1280}
    height={720}
  />
);
