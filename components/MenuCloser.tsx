'use client';

import { useEffect } from 'react';

export default function MenuCloser() {
  useEffect(() => {
    const closeAll = (except?: Element | null) =>
      document.querySelectorAll('details.filter-menu[open]').forEach(d => d !== except && d.removeAttribute('open'));
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element;
      const menu = target.closest('details.filter-menu');
      closeAll(menu);
      if (menu && target.closest('.filter-list a')) menu.removeAttribute('open');
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeAll();
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return null;
}
