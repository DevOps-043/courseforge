import {z} from "zod";
/** Isomorphic, fixed pair. A declaration is not proof of the capture/display profile. */
export const SDR_AUDIO_MUX_POLICY = "COPIED_H264_REC709_AAC_MUX_V1" as const;
/** Internal successful-result binding, not an additional expected execution policy. */
export const SDR_SILENT_ASSEMBLY_POLICY = "COPIED_H264_REC709_SILENT_ASSEMBLY_V1" as const;
export const SDR_FRAME_CONVERSION_POLICY = Object.freeze({
  id: "DECLARED_SRGB_PNG_TO_REC709_LIMITED_V1" as const,
  captureProfile: "OPAQUE_SRGB_RGB_PNG" as const,
  encodeFilter: "format=gbrp,zscale=matrixin=gbr:primariesin=709:transferin=iec61966-2-1:rangein=full:matrix=709:primaries=709:transfer=709:range=limited:chromal=left:dither=none:agamma=0,format=yuv420p",
  compareFilter: "zscale=matrixin=709:primariesin=709:transferin=709:rangein=limited:chromalin=left:matrix=gbr:primaries=709:transfer=iec61966-2-1:range=full:dither=none:agamma=0,format=rgb24",
  scope: "DECLARED_PROFILE_CONVERSION_NOT_CAPTURE_OR_RENDER_ATTESTATION" as const,
});

export const sdrFrameCaptureProfileSchema = z.object({captureProfile: z.literal(SDR_FRAME_CONVERSION_POLICY.captureProfile),
  width: z.number().int().positive().max(4096).multipleOf(2), height: z.number().int().positive().max(4096).multipleOf(2),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
  frameCount: z.number().int().positive().max(36000),
}).strict().refine(profile => profile.frameCount / profile.fps <= 600);
