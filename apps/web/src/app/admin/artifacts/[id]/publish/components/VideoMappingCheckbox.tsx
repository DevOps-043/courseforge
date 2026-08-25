'use client';

import { useEffect, useRef } from 'react';
import styles from '../PublicationWorkspace.module.css';

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
      className={`${styles.mappingCheckbox} ${className || ''}`}
    />
  );
}
