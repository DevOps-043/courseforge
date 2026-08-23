"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  type CSSProperties,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import styles from "./EngineSelect.module.css";

export interface EngineSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface EngineSelectProps {
  "aria-label"?: string;
  className?: string;
  disabled?: boolean;
  icon?: ReactNode;
  label?: string;
  onValueChange: (value: string) => void;
  options: readonly EngineSelectOption[];
  placeholder?: string;
  value: string;
}

export function EngineSelect({
  "aria-label": ariaLabel,
  className,
  disabled = false,
  icon,
  label,
  onValueChange,
  options,
  placeholder = "Seleccionar...",
  value,
}: EngineSelectProps) {
  const reactId = useId();
  const listboxId = `engine-select-${reactId.replace(/:/g, "")}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 7;
    const maxMenuHeight = 304;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openAbove = spaceBelow < Math.min(maxMenuHeight, 220) && spaceAbove > spaceBelow;
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - width - viewportPadding,
    );

    setMenuStyle({
      bottom: openAbove ? window.innerHeight - rect.top + gap : undefined,
      left,
      maxHeight: Math.min(maxMenuHeight, Math.max(120, openAbove ? spaceAbove : spaceBelow)),
      top: openAbove ? undefined : rect.bottom + gap,
      width,
      transformOrigin: openAbove ? "bottom" : "top",
    });
  };

  const close = (restoreFocus = true) => {
    setIsOpen(false);
    setActiveIndex(-1);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const open = (preferredIndex = selectedIndex) => {
    if (disabled) return;
    updatePosition();
    setActiveIndex(preferredIndex >= 0 ? preferredIndex : options.findIndex((option) => !option.disabled));
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close(false);
    };
    const reposition = () => updatePosition();

    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [isOpen]);

  const selectOption = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    close();
  };

  const moveActive = (direction: 1 | -1) => {
    if (options.length === 0) return;
    let next = activeIndex;
    for (let attempts = 0; attempts < options.length; attempts += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next]?.disabled) {
        setActiveIndex(next);
        requestAnimationFrame(() => {
          menuRef.current
            ?.querySelector<HTMLElement>(`[data-index="${next}"]`)
            ?.scrollIntoView({ block: "nearest" });
        });
        break;
      }
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isOpen && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      open(event.key === "ArrowUp" ? options.length - 1 : selectedIndex);
      return;
    }
    if (!isOpen) return;

    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(options.findIndex((option) => !option.disabled));
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.findLastIndex((option) => !option.disabled));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectOption(activeIndex);
    }
  };

  return (
    <div className={`${styles.root} ${className || ""}`}>
      {label ? (
        <span className={styles.label}>
          {icon}
          {label}
        </span>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        data-open={isOpen}
        disabled={disabled}
        aria-label={ariaLabel || label}
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => (isOpen ? close(false) : open())}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.valueWrap}>
          <span className={selectedOption ? styles.value : styles.placeholder}>
            {selectedOption?.label || placeholder}
          </span>
          {selectedOption?.description ? (
            <span className={styles.description}>{selectedOption.description}</span>
          ) : null}
        </span>
        <span className={styles.chevron} aria-hidden="true">
          <ChevronDown size={15} strokeWidth={1.8} />
        </span>
      </button>

      {isOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              role="listbox"
              tabIndex={-1}
              aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
              className={styles.menu}
              style={menuStyle}
              onKeyDown={handleKeyDown}
            >
              {options.map((option, index) => (
                <button
                  key={option.value}
                  id={`${listboxId}-${index}`}
                  type="button"
                  role="option"
                  data-index={index}
                  aria-selected={option.value === value}
                  disabled={option.disabled}
                  className={styles.option}
                  data-active={activeIndex === index}
                  data-selected={option.value === value}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(index)}
                >
                  <span className={styles.optionText}>
                    <span className={styles.optionTitle}>{option.label}</span>
                    {option.description ? (
                      <span className={styles.description}>{option.description}</span>
                    ) : null}
                  </span>
                  {option.value === value ? <Check size={15} className={styles.check} /> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
