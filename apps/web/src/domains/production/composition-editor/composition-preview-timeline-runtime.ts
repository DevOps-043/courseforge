import { scheduleCompositionMotion } from "./composition-motion-timeline";
import { scheduleCompositionTransitions } from "./composition-transition-timeline";
import { COMPOSITION_PLAYBACK_AUDIO_ENVELOPE_VERSION } from "./composition-playback-audio-envelope";
import type { CompositionPreviewTimelineState } from "./composition-preview-timeline-state";

/** Shared installer: live updates use exactly the initial preview/render scheduler. */
export function renderCompositionTimelineInstaller(state: CompositionPreviewTimelineState) {
  return `<script>
    (() => {
    const clips = ${JSON.stringify(state.clips).replace(/</g, "\\u003c")};
    const motionAnimations = ${JSON.stringify(state.motionAnimations).replace(/</g, "\\u003c")};
    const transitionEffects = ${JSON.stringify(state.transitionEffects).replace(/</g, "\\u003c")};
    const volumeAutomations = ${JSON.stringify(state.volumeAutomations).replace(/</g, "\\u003c")};
    window.__courseforgeInstallTimeline = (state) => {
      const { clips, motionAnimations, transitionEffects, volumeAutomations } = state;
      const timeline = gsap.timeline({ paused: true });
      for (const clip of clips) {
        if (clip.kind === "AUDIO") continue;
        const element = document.getElementById(clip.id);
        if (!element) continue;
        // Reused elements can retain GSAP's previous transition transform cache.
        gsap.set(element, { x: 0, y: 0, xPercent: 0, yPercent: 0, scaleX: 1, scaleY: 1, rotation: clip.layoutRotation });
        if (clip.hidden) { timeline.set(element, { autoAlpha: 0 }, 0); continue; }
        timeline.set(element, { autoAlpha: clip.layoutOpacity }, clip.runtimeStart);
        for (const cue of clip.captionCues) {
          const cueElement = document.getElementById(cue.elementId);
          if (!cueElement) continue;
          timeline.set(cueElement, { autoAlpha: 0 }, clip.runtimeStart);
          timeline.set(cueElement, { autoAlpha: 1 }, cue.start);
          timeline.set(cueElement, { autoAlpha: 0 }, cue.end);
          for (const word of cue.words) {
            const wordElement = document.getElementById(word.elementId);
            if (!wordElement) continue;
            timeline.set(wordElement, { opacity: 0.55 }, clip.runtimeStart);
            timeline.set(wordElement, { opacity: 1 }, word.start);
            timeline.set(wordElement, { opacity: 0.55 }, word.end);
          }
        }
        if (clip.kind === "DECK_SLIDE") {
          const deckScope = element.querySelector(".deck-scope");
          if (deckScope) {
            timeline.fromTo(
              deckScope,
              { "--deck-t": 0 },
              { "--deck-t": clip.duration, duration: clip.duration, ease: "none", immediateRender: false },
              clip.start,
            );
          }
        }
        // HyperFrames treats clip intervals as half-open. Hiding at the exact
        // end frame keeps preview seek and renderSeek identical at boundaries.
        timeline.set(element, { autoAlpha: 0 }, clip.runtimeStart + clip.runtimeDuration);
      }
      function addTransitions(targetTimeline, transitions) {
        (${scheduleCompositionTransitions.toString()})(targetTimeline, transitions, (id) => document.getElementById(id));
      }
      addTransitions(timeline, transitionEffects);
      window.__courseforgeAudioEnvelopeVersion = ${COMPOSITION_PLAYBACK_AUDIO_ENVELOPE_VERSION};
      for (const automation of volumeAutomations) {
        const media = document.getElementById(automation.targetClipId + "-audio")
          || document.getElementById(automation.targetClipId);
        if (!media || automation.points.length === 0) continue;
        timeline.set(media, { volume: automation.points[0].volume }, automation.points[0].timeSeconds);
        for (let index = 1; index < automation.points.length; index += 1) {
          const previous = automation.points[index - 1];
          const point = automation.points[index];
          const transitionDuration = Math.max(0, point.timeSeconds - previous.timeSeconds);
          if (transitionDuration === 0) {
            timeline.set(media, { volume: point.volume }, point.timeSeconds);
            continue;
          }
          timeline.fromTo(
            media,
            { volume: previous.volume },
            { volume: point.volume, duration: transitionDuration, ease: "none", immediateRender: false },
            previous.timeSeconds,
          );
        }
      }
      function addMotion(timeline, motionAnimations) {
        (${scheduleCompositionMotion.toString()})(timeline, motionAnimations, (id) => document.getElementById(id));
      }
      let motionTimeline = gsap.timeline();
      let motionTargets = new Set(motionAnimations.map((animation) => animation.targetId));
      addMotion(motionTimeline, motionAnimations);
      timeline.add(motionTimeline, 0);
      // Initialize zero-time sets before exposing the timeline to either seek controller.
      timeline.render(0, true, true);
      window.__courseforgeReplaceMotion = (animations) => {
        const nextTargets = new Set(animations.map((animation) => animation.targetId));
        if ([...nextTargets].some((id) => !document.getElementById(id))) throw new Error("MOTION_TARGET_NOT_FOUND");
        timeline.remove(motionTimeline);
        motionTimeline.kill();
        for (const id of new Set([...motionTargets, ...nextTargets])) {
          const target = document.getElementById(id);
          if (target) gsap.set(target, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
        }
        motionTargets = nextTargets;
        motionTimeline = gsap.timeline();
        addMotion(motionTimeline, animations);
        timeline.add(motionTimeline, 0);
      };
      window.__timelines = window.__timelines || {};
      window.__timelines["courseforge-composition"] = timeline;
      return timeline;
    };
    window.__courseforgeInstallTimeline({ clips, motionAnimations, transitionEffects, volumeAutomations });
    })();
  </script>`;
}
