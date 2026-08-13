'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  /** Controlled value (string or number; matched against option values as strings). */
  value: string | number;
  /** Called with the selected option's string value. */
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Layout classes applied to the root wrapper (margins, width, etc.). */
  className?: string;
  /** Visual overrides applied to the trigger button in addition to `input-field`. */
  triggerClassName?: string;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Shared dark-themed dropdown used across CreatorBoost. Replaces native
 * `<select>` elements so the OS/browser light popup is never shown on mobile.
 * Visually matches the existing `input-field` / glass theme.
 */
export default function Select({
  value,
  onChange,
  options,
  className,
  triggerClassName,
  id,
  ariaLabel,
  placeholder,
  disabled = false,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const listId = useId();

  const valueStr = String(value);
  const selected = options.find(option => option.value === valueStr);
  const displayLabel = selected?.label ?? placeholder ?? valueStr;

  const openMenu = () => {
    const index = options.findIndex(option => option.value === valueStr);
    setActiveIndex(index >= 0 ? index : 0);
    setOpen(true);
  };

  const commit = (option: SelectOption) => {
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const handleTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openMenu();
        else setActiveIndex(i => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openMenu();
        else setActiveIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open && activeIndex >= 0 && activeIndex < options.length) commit(options[activeIndex]);
        else openMenu();
        break;
      case 'Tab':
        if (open) setOpen(false);
        break;
      case 'Home':
        if (open) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (open) {
          event.preventDefault();
          setActiveIndex(options.length - 1);
        }
        break;
      default:
        break;
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          'input-field flex items-center justify-between gap-2 text-left cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed',
          triggerClassName,
        )}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown
          className={cn('w-4 h-4 text-gray-500 flex-shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={id}
          tabIndex={-1}
          className="absolute z-50 left-0 right-0 top-full mt-1.5 max-h-64 overflow-y-auto rounded-xl bg-[#0f0a1f] border border-white/10 shadow-2xl p-1"
        >
          {options.map((option, index) => {
            const isSelected = option.value === valueStr;
            const isActive = index === activeIndex;
            return (
              <li key={option.value} role="option" aria-selected={isSelected} className="list-none">
                <button
                  ref={isActive ? activeRef : undefined}
                  type="button"
                  onClick={() => commit(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    isSelected ? 'bg-purple-500/20 text-white' : 'text-gray-200',
                    !isSelected && isActive && 'bg-white/10',
                    !isSelected && !isActive && 'hover:bg-white/5',
                  )}
                >
                  <span className="whitespace-normal break-words">{option.label}</span>
                  {isSelected && <Check className="w-4 h-4 text-purple-300 flex-shrink-0" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
