"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import styles from "./EngineSelect.module.css";

export interface EngineSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  group?: string;
}

interface EngineSelectProps {
  "aria-label"?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  icon?: ReactNode;
  label?: string;
  onValueChange: (value: string) => void;
  options: readonly EngineSelectOption[];
  placeholder?: string;
  required?: boolean;
  size?: "standard" | "compact";
  title?: string;
  value: string;
}

export function EngineSelect({
  "aria-label": ariaLabel,
  className,
  disabled = false,
  id,
  icon,
  label,
  onValueChange,
  options,
  placeholder = "Seleccionar...",
  required,
  size = "standard",
  title,
  value,
}: EngineSelectProps) {
  const reactId = useId();
  const triggerId = id ?? `${reactId}-trigger`;
  const listboxId = `${reactId}-options`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const searchRef = useRef({ text: "", lastKeyAt: 0 });
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = options[selectedIndex];
  const menuOpen = isOpen && !disabled && options.length > 0;
  const useTopLayer = menuOpen && typeof HTMLElement.prototype.showPopover === "function";
  const firstEnabled = options.findIndex((option) => !option.disabled);
  const lastEnabled = options.findLastIndex((option) => !option.disabled);
  const activeOption = options[activeIndex];
  const activeOptionId = menuOpen && activeOption && !activeOption.disabled
    ? `${listboxId}-${activeIndex}`
    : undefined;

  function updatePosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const padding = 12;
    const gap = 7;
    const maxMenuHeight = 304;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const spaceBelow = viewportHeight - rect.bottom - padding - gap;
    const spaceAbove = rect.top - padding - gap;
    const openAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const availableWidth = viewportWidth - padding * 2;
    const width = viewportWidth <= 640
      ? availableWidth
      : Math.min(Math.max(rect.width, 220), availableWidth);
    const left = Math.min(Math.max(padding, rect.left), viewportWidth - width - padding);

    setMenuStyle({
      bottom: openAbove ? viewportHeight - rect.top + gap : undefined,
      left,
      maxHeight: Math.max(0, Math.min(maxMenuHeight, openAbove ? spaceAbove : spaceBelow)),
      top: openAbove ? undefined : rect.bottom + gap,
      width,
      transformOrigin: openAbove ? "bottom" : "top",
    });
  }

  function close() {
    setIsOpen(false);
    searchRef.current.text = "";
  }

  function open(index = selectedOption?.disabled || selectedIndex < 0 ? firstEnabled : selectedIndex) {
    if (disabled || options.length === 0) return;
    triggerRef.current?.focus({ preventScroll: true });
    updatePosition();
    setActiveIndex(index);
    setIsOpen(true);
  }

  useLayoutEffect(() => {
    if (!useTopLayer) return;
    menuRef.current?.showPopover();
  }, [useTopLayer]);

  useEffect(() => {
    if (!menuOpen) return;

    function handleOutsidePointer(event: PointerEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
    }

    function handleScroll(event: Event) {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) close();
      else updatePosition();
    }

    document.addEventListener("pointerdown", handleOutsidePointer);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!activeOptionId) return;
    const menu = menuRef.current;
    const option = document.getElementById(activeOptionId);
    if (!menu || !option) return;
    const menuBounds = menu.getBoundingClientRect();
    const optionBounds = option.getBoundingClientRect();
    if (optionBounds.top < menuBounds.top) {
      menu.scrollTop -= menuBounds.top - optionBounds.top;
    } else if (optionBounds.bottom > menuBounds.bottom) {
      menu.scrollTop += optionBounds.bottom - menuBounds.bottom;
    }
  }, [activeOptionId]);

  function selectOption(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    close();
    if (option.value !== value) onValueChange(option.value);
  }

  function moveActive(direction: 1 | -1) {
    const nextIndex = direction === 1
      ? options.findIndex((option, index) => index > activeIndex && !option.disabled)
      : options.findLastIndex((option, index) => index < activeIndex && !option.disabled);
    setActiveIndex(nextIndex >= 0 ? nextIndex : direction === 1 ? firstEnabled : lastEnabled);
  }

  function searchByLabel(key: string) {
    const now = Date.now();
    const previous = now - searchRef.current.lastKeyAt < 600 ? searchRef.current.text : "";
    const character = normalizeLabel(key);
    const repeated = previous === character;
    const query = repeated ? character : previous + character;
    searchRef.current = { text: query, lastKeyAt: now };
    const start = menuOpen ? activeIndex : selectedIndex;
    const offset = previous && !repeated ? 0 : 1;

    for (let count = 0; count < options.length; count += 1) {
      const index = (Math.max(start, -offset) + offset + count) % options.length;
      const option = options[index];
      if (!option.disabled && normalizeLabel(option.label).startsWith(query)) {
        if (menuOpen) setActiveIndex(index);
        else open(index);
        return;
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab") {
      close();
      return;
    }
    if (event.key === "Escape" && menuOpen) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }

    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (menuOpen) moveActive(event.key === "ArrowDown" ? 1 : -1);
        else if (event.key === "ArrowUp") open(lastEnabled);
        else open();
        break;
      case "Home":
      case "End": {
        event.preventDefault();
        const index = event.key === "Home" ? firstEnabled : lastEnabled;
        if (menuOpen) setActiveIndex(index);
        else open(index);
        break;
      }
      case "Enter":
      case " ":
        event.preventDefault();
        if (menuOpen) selectOption(activeIndex);
        else open();
        break;
      default:
        if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          searchByLabel(event.key);
        }
    }
  }

  function renderOption(option: EngineSelectOption, index: number) {
    const selected = index === selectedIndex;
    return (
      <span
        key={index}
        id={`${listboxId}-${index}`}
        role="option"
        aria-selected={selected}
        aria-disabled={option.disabled || undefined}
        className={styles.option}
        data-active={activeOptionId === `${listboxId}-${index}`}
        data-selected={selected}
        onClick={(event) => {
          event.preventDefault();
          selectOption(index);
        }}
      >
        <span className={styles.optionText}>
          <span className={styles.optionTitle}>{option.label}</span>
          {option.description ? <span className={styles.description}>{option.description}</span> : null}
        </span>
        {selected ? <Check size={15} className={styles.check} aria-hidden="true" /> : null}
      </span>
    );
  }

  function renderOptions() {
    const sections: { label?: string; options: ReactNode[] }[] = [];
    for (const [index, option] of options.entries()) {
      if (sections.length === 0 || sections.at(-1)?.label !== option.group) {
        sections.push({ label: option.group, options: [] });
      }
      sections.at(-1)?.options.push(renderOption(option, index));
    }
    return sections.map((section) => section.label ? (
      <span key={section.label} role="group" aria-label={section.label}>
        <span className={styles.groupLabel} aria-hidden="true">{section.label}</span>
        {section.options}
      </span>
    ) : section.options);
  }

  const menu = menuOpen ? (
    <span
      ref={menuRef}
      id={listboxId}
      role="listbox"
      aria-label={ariaLabel || label || selectedOption?.label || placeholder}
      popover={useTopLayer ? "manual" : undefined}
      className={styles.menu}
      style={menuStyle}
      onMouseDown={(event) => event.preventDefault()}
    >
      {renderOptions()}
    </span>
  ) : null;

  return (
    <span className={`${styles.root} ${className || ""}`} data-size={size}>
      {label ? (
        <label className={styles.label} htmlFor={triggerId}>
          {icon}
          {label}
        </label>
      ) : null}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        className={styles.trigger}
        data-open={menuOpen}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel || label}
        aria-controls={menuOpen ? listboxId : undefined}
        aria-expanded={menuOpen}
        aria-haspopup="listbox"
        aria-activedescendant={activeOptionId}
        aria-required={required}
        onBlur={close}
        onClick={() => (menuOpen ? close() : open())}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.valueWrap}>
          <span className={selectedOption ? styles.value : styles.placeholder}>
            {selectedOption?.label || placeholder}
          </span>
          {size === "standard" && selectedOption?.description ? (
            <span className={styles.description}>{selectedOption.description}</span>
          ) : null}
        </span>
        <span className={styles.chevron} aria-hidden="true">
          <ChevronDown size={15} strokeWidth={1.8} />
        </span>
      </button>

      {menu && (useTopLayer ? menu : createPortal(menu, document.body))}
    </span>
  );
}

function normalizeLabel(label: string) {
  return label.toLocaleLowerCase("es").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
