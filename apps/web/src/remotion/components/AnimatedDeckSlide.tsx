import type { CSSProperties } from "react";
import type { AssemblySlide } from "../types";

interface AnimatedDeckSlideProps {
  slide: AssemblySlide;
  localFrame: number;
  fps: number;
  width: number;
  height: number;
}

const DECK_WIDTH = 1920;
const DECK_HEIGHT = 1080;

export function AnimatedDeckSlide({
  slide,
  localFrame,
  fps,
  width,
  height,
}: AnimatedDeckSlideProps) {
  const scale = Math.min(width / DECK_WIDTH, height / DECK_HEIGHT);
  const scaledWidth = DECK_WIDTH * scale;
  const scaledHeight = DECK_HEIGHT * scale;
  const left = (width - scaledWidth) / 2;
  const top = (height - scaledHeight) / 2;

  return (
    <div
      className="deck-scope"
      style={{
        backgroundColor: "#000",
        height,
        overflow: "hidden",
        position: "relative",
        width,
      }}
    >
      <div
        className="deck-stage"
        style={{
          height: DECK_HEIGHT,
          left,
          position: "absolute",
          top,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: DECK_WIDTH,
        }}
      >
        <section
          className={`${slide.classes || "slide"} active`}
          style={
            {
              "--deck-t": String(localFrame / fps),
            } as CSSProperties
          }
          dangerouslySetInnerHTML={{ __html: slide.html || "" }}
        />
      </div>
    </div>
  );
}
