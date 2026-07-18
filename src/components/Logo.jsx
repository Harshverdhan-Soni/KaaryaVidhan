/**
 * The KaaryaVidhan mark — a check rising out of a partly-filled task bar,
 * echoing the Pace Bar the app is built around. One source, sized by prop.
 */
export function LogoMark({ size = 36, radius }) {
  const r = radius ?? size * 0.28;
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="shrink-0">
      <rect width="512" height="512" rx={512 * 0.22} fill="#0B4E8C" />
      <rect x="132" y="330" width="248" height="34" rx="17" fill="#2E7BC4" opacity=".5" />
      <rect x="132" y="330" width="140" height="34" rx="17" fill="#2E7BC4" />
      <path d="M156 250 L232 322 L388 158" fill="none" stroke="#fff"
            strokeWidth="42" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The full wordmark: mark + two-tone "KaaryaVidhan". */
export function Wordmark({ size = 36, text = 'text-base' }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className={`font-display font-bold leading-none tracking-tight ${text}`}>
        <span className="text-ink">Kaarya</span><span className="text-blue">Vidhan</span>
      </span>
    </div>
  );
}
