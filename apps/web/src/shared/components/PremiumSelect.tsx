"use client";

import type { ReactNode } from "react";
import {
  EngineSelect,
  type EngineSelectOption,
} from "@/components/ui/EngineSelect";

export type Option = EngineSelectOption;

interface PremiumSelectProps {
  options: readonly Option[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  icon?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** Compatibility facade for the former shared select API. */
export function PremiumSelect({
  className,
  disabled,
  icon,
  label,
  onChange,
  options,
  placeholder,
  value,
}: PremiumSelectProps) {
  return (
    <EngineSelect
      className={className}
      disabled={disabled}
      icon={icon}
      label={label}
      onValueChange={onChange}
      options={options}
      placeholder={placeholder}
      value={value}
    />
  );
}
