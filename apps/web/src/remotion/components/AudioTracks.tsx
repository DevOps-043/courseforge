import { Audio } from "remotion";

interface AudioTracksProps {
  voiceAudioUrl?: string;
  bgMusicUrl?: string;
  bgMusicVolume: number;
}

/**
 * Pistas de audio del ensamblado: locución (una pasada) + música de fondo
 * (en loop hasta cubrir la composición, con volumen atenuado).
 *
 * Nota de diseño (plan 1.3): cuando hay locución y avatar a la vez, el avatar
 * se silencia en su capa de video y la voz maestra suena por aquí.
 */
export function AudioTracks({
  voiceAudioUrl,
  bgMusicUrl,
  bgMusicVolume,
}: AudioTracksProps) {
  return (
    <>
      {voiceAudioUrl ? <Audio src={voiceAudioUrl} /> : null}
      {bgMusicUrl ? (
        <Audio src={bgMusicUrl} volume={bgMusicVolume} loop />
      ) : null}
    </>
  );
}