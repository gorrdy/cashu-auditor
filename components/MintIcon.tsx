export default function MintIcon({ id, hash, size = 24 }: { id: string; hash: string | null; size?: number }) {
  const style = { width: size, height: size, borderRadius: size >= 40 ? 12 : 6 };
  if (!hash) return <span className="mint-icon" style={style} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="mint-icon" style={style} src={`/mint-icon/${id}?v=${hash}`} alt="" loading="lazy" />;
}
