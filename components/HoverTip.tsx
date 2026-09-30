'use client';

import { useEffect, useRef } from 'react';

export default function HoverTip() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tip = ref.current!;
    let current: HTMLElement | null = null;

    const render = (el: HTMLElement) => {
      const [value, ...rest] = (el.dataset.tip ?? '').split('\n');
      tip.replaceChildren();
      const strong = document.createElement('strong');
      strong.textContent = value;
      tip.appendChild(strong);
      for (const line of rest) {
        const span = document.createElement('span');
        span.textContent = line;
        tip.appendChild(span);
      }
      tip.hidden = false;
    };

    const place = (x: number, y: number) => {
      const { width, height } = tip.getBoundingClientRect();
      const left = Math.min(window.innerWidth - width - 8, Math.max(8, x - width / 2));
      const top = y - height - 12 < 8 ? y + 16 : y - height - 12;
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };

    const onMove = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (!el) {
        if (current) { tip.hidden = true; current = null; }
        return;
      }
      if (el !== current) { current = el; render(el); }
      place(e.clientX, e.clientY);
    };
    const onFocus = (e: FocusEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (!el) return;
      current = el;
      render(el);
      const r = el.getBoundingClientRect();
      place(r.left + r.width / 2, r.top);
    };
    const hide = () => { tip.hidden = true; current = null; };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('scroll', hide, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('scroll', hide);
    };
  }, []);

  return <div ref={ref} className="tip" role="tooltip" hidden />;
}
