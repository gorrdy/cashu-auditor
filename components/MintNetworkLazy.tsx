'use client';

import dynamic from 'next/dynamic';

const MintNetwork = dynamic(() => import('./MintNetwork'), {
  ssr: false,
  loading: () => <div className="network-stage" style={{ aspectRatio: '3 / 2' }} aria-busy="true" />,
});

export default MintNetwork;
