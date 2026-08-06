import type { CSSProperties } from "react";
import type { AssemblySlide } from "../types";
import { repairCommonUtf8Mojibake } from "../../domains/production/text/mojibake.service";

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
  const classList = (slide.classes || "slide").split(/\s+/).filter(Boolean);
  if (!classList.includes("active")) {
    classList.push("active");
  }
  const slideHtml = repairCommonUtf8Mojibake(slide.html || "");

  return (
    <div
      className="deck-scope"
      style={{
        backgroundColor: "#ffffff",
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
          className={classList.join(" ")}
          style={
            {
              "--deck-t": String(localFrame / fps),
            } as CSSProperties
          }
          dangerouslySetInnerHTML={{ __html: slideHtml }}
        />
      </div>
    </div>
  );
}
