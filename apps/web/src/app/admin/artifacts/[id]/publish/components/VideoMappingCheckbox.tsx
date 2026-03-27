'use client';

import { useEffect, useRef } from 'react';

interface VideoMappingCheckboxProps {
  checked: boolean;
  indeterminate: boolean;
  disabled?: boolean;
  onChange: () => void;
  className?: string;
}

export function VideoMappingCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
  className,
}: VideoMappingCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className={`w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-[#00D4B3] focus:ring-[#00D4B3]/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${className || ''}`}
    />
  );
}
