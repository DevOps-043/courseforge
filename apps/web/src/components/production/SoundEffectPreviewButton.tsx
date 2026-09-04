'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';

type SoundEffectPreviewButtonProps = {
    soundEffectId: string;
};

/** Plays an authorized server redirect; private Storage URLs are never persisted in the browser state. */
export function SoundEffectPreviewButton({ soundEffectId }: SoundEffectPreviewButtonProps) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isStarting, setIsStarting] = useState(false);

    useEffect(() => {
        const pauseOtherPreview = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== soundEffectId) audioRef.current?.pause();
        };
        window.addEventListener('sound-effect-preview-start', pauseOtherPreview);
        return () => {
            window.removeEventListener('sound-effect-preview-start', pauseOtherPreview);
            audioRef.current?.pause();
        };
    }, [soundEffectId]);

    const togglePreview = async () => {
        if (audioRef.current?.paused === false) {
            audioRef.current.pause();
            return;
        }
        const audio = new Audio(`/api/production/sound-effects/${soundEffectId}/preview`);
        audio.preload = 'metadata';
        audio.onended = () => setIsPlaying(false);
        audio.onpause = () => setIsPlaying(false);
        audio.onplay = () => setIsPlaying(true);
        audio.onerror = () => setIsPlaying(false);
        audioRef.current = audio;
        setIsStarting(true);
        try {
            window.dispatchEvent(new CustomEvent('sound-effect-preview-start', { detail: soundEffectId }));
            await audio.play();
        } catch {
            setIsPlaying(false);
        } finally {
            setIsStarting(false);
        }
    };

    return (
        <button
            type="button"
            onClick={() => void togglePreview()}
            disabled={isStarting}
            className="flex h-8 items-center justify-center gap-1 rounded-md border border-[var(--engine-muted)]/20 px-2 text-xs text-gray-300 transition-colors hover:border-[var(--engine-accent)]/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={isPlaying ? 'Pausar preescucha' : 'Escuchar efecto'}
            title={isPlaying ? 'Pausar' : 'Escuchar'}
        >
            {isStarting ? <Loader2 size={13} className="animate-spin" /> : isPlaying ? <Pause size={13} /> : <Play size={13} />}
            <span>{isPlaying ? 'Pausar' : 'Escuchar'}</span>
        </button>
    );
}
