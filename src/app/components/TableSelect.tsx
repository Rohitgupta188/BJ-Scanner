'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Option {
  value: string | number;
  label: string;
}

interface TableSelectProps {
  value: string | number;
  options: Option[];
  onChange: (value: string | number) => void;
}

export default function TableSelect({ value, options, onChange }: TableSelectProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Loose matching: "18", 18, "18K" all resolve to the 18 option
  const normalize = (v: string | number) =>
    String(v).replace(/k$/i, '').trim();
  const selected = options.find(o => normalize(o.value) === normalize(value));

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 72),
      });
    }
    setOpen(true);
  };

  // Close on outside click, Escape, scroll, or resize
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ts-trigger"
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <span>{selected?.label ?? String(value)}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none"
          style={{ transition: 'transform 0.18s', transform: open ? 'rotate(180deg)' : 'none' }}>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className="ts-menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width }}
        >
          {options.map(opt => {
            const isActive = normalize(opt.value) === normalize(value);
            return (
              <button
                key={opt.value}
                type="button"
                className={`ts-item ${isActive ? 'ts-item-active' : ''}`}
                onClick={() => { onChange(opt.value); setOpen(false); }}
              >
                <span>{opt.label}</span>
                {isActive && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}