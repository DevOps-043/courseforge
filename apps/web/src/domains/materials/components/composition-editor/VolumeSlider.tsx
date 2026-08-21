"use client";

interface VolumeSliderProps {
  accentClassName: string;
  ariaLabel: string;
  disabled: boolean;
  label: string;
  onChange: (value: number) => void;
  value: number;
}

export function VolumeSlider({
  accentClassName,
  ariaLabel,
  disabled,
  label,
  onChange,
  value,
}: VolumeSliderProps) {
  const percentage = Math.round(value * 100);

  return (
    <label className="block text-xs font-medium text-slate-600 dark:text-gray-300">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="font-mono tabular-nums">{percentage}%</span>
      </span>
      <input
        aria-label={ariaLabel}
        aria-valuetext={`${percentage}%`}
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className={`mt-2 w-full ${accentClassName}`}
      />
    </label>
  );
}
