import { useId } from "react";

export type DripMood = "happy" | "cheer" | "proud" | "wow" | "calm" | "think";

/**
 * Drip, the PoolFi mascot. It bobs and blinks on its own; `move` makes it jump
 * or wiggle, and `pop` springs it in when it first appears.
 */
export function Drip({ size = 120, mood = "happy", onBlue = false, move, pop }: { size?: number; mood?: DripMood; onBlue?: boolean; move?: "jump" | "wiggle"; pop?: boolean }) {
  const gradient = useId();
  const closedEyes = mood === "cheer" || mood === "proud";
  const className = ["drip", move, pop && "pop"].filter(Boolean).join(" ");
  return (
    <svg className={className} width={size} height={Math.round(size * 1.22)} viewBox="0 -8 100 122" aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#21BCEE" />
          <stop offset="1" stopColor="#1B4FD8" />
        </linearGradient>
      </defs>
      <ellipse cx="50" cy="110" rx="26" ry="4.5" fill={onBlue ? "rgba(3,24,94,.35)" : "rgba(5,38,152,.14)"} />
      <g className="bd">
        <path
          d="M50 2 C50 2 12 46 12 70 a38 38 0 0 0 76 0 C88 46 50 2 50 2Z"
          fill={`url(#${gradient})`}
          stroke="#052698"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
        <ellipse cx="33" cy="44" rx="6" ry="11" transform="rotate(-28 33 44)" fill="rgba(255,255,255,.55)" />
        <ellipse cx="26" cy="80" rx="6" ry="3.5" fill="rgba(255,255,255,.35)" />
        <ellipse cx="74" cy="80" rx="6" ry="3.5" fill="rgba(255,255,255,.35)" />
        {closedEyes ? (
          <>
            <path d="M30 67 Q38 58 46 67" stroke="#052698" strokeWidth="4.5" fill="none" strokeLinecap="round" />
            <path d="M54 67 Q62 58 70 67" stroke="#052698" strokeWidth="4.5" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx="38" cy="66" r="9.5" fill="#fff" />
            <circle cx="62" cy="66" r="9.5" fill="#fff" />
            <circle cx="39.5" cy="67" r="5" fill="#052698" />
            <circle cx="63.5" cy="67" r="5" fill="#052698" />
            <circle cx="41.3" cy="64.8" r="1.8" fill="#fff" />
            <circle cx="65.3" cy="64.8" r="1.8" fill="#fff" />
            {/* Eyelids, closed for a moment every few seconds */}
            <ellipse className="lid" cx="38" cy="66" rx="10.5" ry="10.5" fill="#1F7FE3" />
            <ellipse className="lid" cx="62" cy="66" rx="10.5" ry="10.5" fill="#1F7FE3" />
          </>
        )}
        {mood === "cheer" ? (
          <>
            <path d="M38 79 Q50 99 62 79 Z" fill="#052698" />
            <path d="M44 89 Q50 95 56 89 Q50 86 44 89Z" fill="#F7A8B8" />
          </>
        ) : mood === "wow" ? (
          <ellipse cx="50" cy="85" rx="5.5" ry="6.5" fill="#052698" />
        ) : mood === "calm" ? (
          <path d="M43 84 Q50 88 57 84" stroke="#052698" strokeWidth="4" fill="none" strokeLinecap="round" />
        ) : mood === "think" ? (
          <path d="M43 85 L57 83" stroke="#052698" strokeWidth="4" fill="none" strokeLinecap="round" />
        ) : (
          <path
            d={mood === "proud" ? "M40 81 Q50 93 60 81" : "M41 82 Q50 91 59 82"}
            stroke="#052698"
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
          />
        )}
      </g>
    </svg>
  );
}
