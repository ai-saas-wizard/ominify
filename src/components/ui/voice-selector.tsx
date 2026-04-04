"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { VOICES, getVoiceById } from "@/lib/voices";
import type { VoiceOption } from "@/lib/voices";

interface VoiceSelectorProps {
    value: string;
    onChange: (voiceId: string) => void;
    name?: string;
    compact?: boolean;
}

export function VoiceSelector({
    value,
    onChange,
    name,
    compact = false,
}: VoiceSelectorProps) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playingId, setPlayingId] = useState<string | null>(null);

    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, []);

    const handlePlay = useCallback(
        (e: React.MouseEvent, voice: VoiceOption) => {
            e.stopPropagation();

            // If already playing this voice, pause
            if (playingId === voice.voiceId) {
                audioRef.current?.pause();
                setPlayingId(null);
                return;
            }

            // Stop current audio
            if (audioRef.current) {
                audioRef.current.pause();
            }

            // Create new audio and play
            const audio = new Audio(voice.previewUrl);
            audioRef.current = audio;

            audio.addEventListener("ended", () => setPlayingId(null));
            audio.addEventListener("error", () => setPlayingId(null));

            audio.play().then(() => {
                setPlayingId(voice.voiceId);
            }).catch(() => {
                setPlayingId(null);
            });
        },
        [playingId]
    );

    return (
        <div>
            {name && <input type="hidden" name={name} value={value} />}
            <div
                className={cn(
                    "grid gap-3",
                    compact ? "grid-cols-1" : "grid-cols-2"
                )}
            >
                {VOICES.map((voice) => {
                    const isSelected = value === voice.voiceId;
                    const isPlaying = playingId === voice.voiceId;

                    return (
                        <button
                            key={voice.voiceId}
                            type="button"
                            onClick={() => onChange(voice.voiceId)}
                            className={cn(
                                "relative flex items-center gap-3 rounded-xl border p-3 text-left transition-all",
                                isSelected
                                    ? "border-emerald-400 bg-emerald-50/40 ring-2 ring-emerald-500/20"
                                    : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50"
                            )}
                        >
                            {/* Play button */}
                            <div
                                role="button"
                                tabIndex={0}
                                onClick={(e) => handlePlay(e, voice)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        handlePlay(
                                            e as unknown as React.MouseEvent,
                                            voice
                                        );
                                    }
                                }}
                                className={cn(
                                    "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors",
                                    isPlaying
                                        ? "bg-emerald-100 text-emerald-600"
                                        : "bg-gray-100 text-gray-500 hover:bg-emerald-50 hover:text-emerald-600"
                                )}
                            >
                                {isPlaying ? (
                                    <Pause className="h-3.5 w-3.5 fill-current" />
                                ) : (
                                    <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                                )}
                            </div>

                            {/* Voice info */}
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-gray-900">
                                    {voice.name}
                                </div>
                                <div className="text-xs text-gray-500">
                                    {voice.description}
                                </div>
                            </div>

                            {/* Selected indicator */}
                            {isSelected && (
                                <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                                    <Check className="h-3 w-3" strokeWidth={3} />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// Lightweight inline play button for read-only voice displays
export function VoicePlayButton({
    voiceId,
    className,
}: {
    voiceId: string;
    className?: string;
}) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, []);

    const voice = getVoiceById(voiceId);
    if (!voice) return null;

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();

        if (isPlaying) {
            audioRef.current?.pause();
            setIsPlaying(false);
            return;
        }

        if (audioRef.current) {
            audioRef.current.pause();
        }

        const audio = new Audio(voice.previewUrl);
        audioRef.current = audio;
        audio.addEventListener("ended", () => setIsPlaying(false));
        audio.addEventListener("error", () => setIsPlaying(false));
        audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors",
                isPlaying
                    ? "bg-emerald-100 text-emerald-600"
                    : "bg-gray-100 text-gray-400 hover:bg-emerald-50 hover:text-emerald-600",
                className
            )}
            title={`Play ${voice.name} preview`}
        >
            {isPlaying ? (
                <Pause className="h-2.5 w-2.5 fill-current" />
            ) : (
                <Play className="h-2.5 w-2.5 fill-current ml-px" />
            )}
        </button>
    );
}
