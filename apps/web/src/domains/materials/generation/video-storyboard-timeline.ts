import type { StoryboardItem, VideoGuideContent } from "../types/materials.types";
import type { VideoDurationContract } from "../../video-duration/video-duration-policy";
import {
  allocateIntegerDuration,
  countEditorialCharacters,
  formatTimecode,
} from "../../video-duration/video-duration-validation";
import type { VideoStoryboardDraft } from "./video-generation.contracts";

export interface StoryboardNarrationTake {
  take_number: number;
  section_number: number;
  narration_text: string;
  timecode_start: string;
  timecode_end: string;
  visual_notes: string;
}

/** Fix the narration before asking the model for visuals; never repartition it afterwards. */
export function buildStoryboardNarration(
  video: VideoGuideContent,
  contract: VideoDurationContract,
): StoryboardNarrationTake[] {
  const sections = video.script.sections;
  const words = sections.map((section) => section.narration_text.split(/\s+/).filter(Boolean));
  const capacities = sections.map((section, index) => Math.min(words[index].length, section.duration_seconds));
  const counts = sections.map((section, index) => Math.min(
    capacities[index],
    Math.max(2, Math.ceil(section.duration_seconds / contract.visualBeatCadenceSeconds)),
  ));
  while (counts.reduce((total, count) => total + count, 0) < contract.minimumStoryboardTakes) {
    const eligible = sections.map((section, index) => ({
      index,
      weight: section.duration_seconds / Math.max(1, counts[index]),
    })).filter(({ index }) => counts[index] < capacities[index]);
    eligible.sort((left, right) => right.weight - left.weight);
    if (!eligible.length) throw new Error("STORYBOARD_CAPACITY: El guion no admite suficientes tomas con narración y duración positivas.");
    counts[eligible[0].index]++;
  }

  const takes: StoryboardNarrationTake[] = [];
  let secondsCursor = 0;
  sections.forEach((section, sectionIndex) => {
    const tokenCounts = allocateIntegerDuration(Array(counts[sectionIndex]).fill(1), words[sectionIndex].length);
    let wordCursor = 0;
    const narrations = tokenCounts.map((count) => {
      const narration = words[sectionIndex].slice(wordCursor, wordCursor + count).join(" ");
      wordCursor += count;
      return narration;
    });
    // Reserve one second per take, then distribute the remaining duration by text length.
    const extraSeconds = allocateIntegerDuration(narrations.map(countEditorialCharacters), section.duration_seconds - narrations.length);
    narrations.forEach((narration, index) => {
      const start = secondsCursor;
      secondsCursor += 1 + extraSeconds[index];
      takes.push({
        take_number: takes.length + 1,
        section_number: sectionIndex + 1,
        narration_text: narration,
        timecode_start: formatTimecode(start),
        timecode_end: formatTimecode(secondsCursor),
        visual_notes: section.visual_notes,
      });
    });
  });
  return takes;
}

export function assembleStoryboard(
  narration: StoryboardNarrationTake[],
  draft: VideoStoryboardDraft,
): StoryboardItem[] {
  const visuals = new Map(draft.storyboard.map((take) => [take.take_number, take]));
  if (visuals.size !== narration.length || draft.storyboard.length !== narration.length
      || narration.some((take) => !visuals.has(take.take_number))) {
    throw new Error("STORYBOARD_TAKE_MAPPING: Devuelve exactamente una toma por take_number recibido, sin duplicados ni omisiones.");
  }
  return narration.map((take) => ({
    ...visuals.get(take.take_number)!,
    narration_text: take.narration_text,
    timecode_start: take.timecode_start,
    timecode_end: take.timecode_end,
  }));
}
