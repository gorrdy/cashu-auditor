'use client';

import { useEffect, useState } from 'react';

type Design = 'classic' | 'modern';

export default function DesignSwitch({ initial }: { initial: Design }) {
  const [design, setDesign] = useState<Design>(initial);
  useEffect(() => {
    document.documentElement.setAttribute('data-design', design);
    window.document.cookie = `design=${design}; path=/; max-age=31536000; samesite=lax`;
  }, [design]);
  return (
    <div className="design-switch" role="group" aria-label="Design">
      {(['classic', 'modern'] as const).map(d => (
        <button key={d} type="button" aria-pressed={design === d} onClick={() => setDesign(d)}>
          {d === 'classic' ? 'Classic' : 'Modern'}
        </button>
      ))}
    </div>
  );
}
