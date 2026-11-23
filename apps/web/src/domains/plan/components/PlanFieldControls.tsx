"use client";

import type {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

type PremiumInputProps = InputHTMLAttributes<HTMLInputElement>;
type PremiumTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const PremiumInput = ({ className, value, ...props }: PremiumInputProps) => (
  <input
    className={`w-full px-4 py-2.5 rounded-xl bg-white border border-gray-200
              text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[var(--engine-accent)]/50 focus:bg-white
              dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-white/30 dark:focus:bg-white/10
              transition-all duration-200 ${className}`}
    value={value != null && !Number.isNaN(value) ? value : ""}
    {...props}
  />
);

export const PremiumTextarea = ({
  className,
  value,
  ...props
}: PremiumTextareaProps) => (
  <textarea
    className={`w-full px-4 py-3 rounded-xl bg-white border border-gray-200
              text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[var(--engine-accent)]/50 focus:bg-white
              dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-white/30 dark:focus:bg-white/10
              transition-all duration-200 resize-none ${className}`}
    value={value != null && !Number.isNaN(value) ? value : ""}
    {...props}
  />
);
