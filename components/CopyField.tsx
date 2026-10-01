'use client';

import { useState } from 'react';

export default function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ marginTop: 10 }}>
      <div className="small soft" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span>{label}</span>
        <button
          type="button"
          className="btn secondary"
          style={{ height: 26, padding: '0 10px', fontSize: 12 }}
          onClick={async () => {
            try {
              if (navigator.clipboard) await navigator.clipboard.writeText(value);
              else {
                const area = document.createElement('textarea');
                area.value = value;
                document.body.appendChild(area);
                area.select();
                document.execCommand('copy');
                area.remove();
              }
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {}
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="mono small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: 'var(--surface-2)', padding: 10, borderRadius: 4, margin: 0 }}>{value}</pre>
    </div>
  );
}
