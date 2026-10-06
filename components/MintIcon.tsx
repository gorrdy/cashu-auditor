export default function MintIcon({ id, hash, label, size = 24 }: { id: string; hash: string | null; label?: string; size?: number }) {
  const style = { width: size, height: size, borderRadius: size >= 40 ? 12 : 6 };
  if (!hash) {
    const letter = label?.replace(/^https?:\/\/(www\.|mint\.)?/i, '').match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '';
    return <span className="mint-icon mint-mono" style={{ ...style, fontSize: Math.round(size * 0.46) }} aria-hidden="true">{letter}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="mint-icon" style={style} src={`/mint-icon/${id}?v=${hash}`} alt="" loading="lazy" />;
}
