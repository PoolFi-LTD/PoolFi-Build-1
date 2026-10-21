export type IconName =
  | "home" | "pools" | "plus" | "activity" | "user" | "bell" | "back" | "close" | "check" | "chev" | "copy"
  | "share" | "lock" | "key" | "refresh" | "send" | "search" | "info" | "bank" | "card" | "download" | "qr"
  | "users" | "clock" | "edit" | "shield" | "more" | "out" | "wa" | "mail" | "sms" | "del" | "minus"
  | "wallet" | "cal" | "sound" | "uplus" | "image" | "file" | "upload" | "gear" | "plus2" | "drop"
  | "camera2" | "help";

/** An icon from /icons.svg; it takes the current text colour. */
export function Icon({ name, size, className }: { name: IconName; size?: number; className?: string }) {
  // Without `size` the icon is 24px, or whatever its surroundings set (e.g. 20px in buttons).
  return (
    <svg className={className ? `icon ${className}` : "icon"} style={size ? { width: size, height: size } : undefined} aria-hidden="true">
      <use href={`/icons.svg#i-${name}`} />
    </svg>
  );
}

/** The PoolFi logo: the piggy bank mark and the wordmark, in the current text colour. */
export function Logo({ size = 34, tone = "blue" }: { size?: number; tone?: "blue" | "white" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.22,
        color: tone === "white" ? "var(--white)" : "var(--blue)",
        fontFamily: "var(--font-display)",
        fontWeight: 700,
        fontSize: size * 0.68,
        letterSpacing: "-0.02em",
        lineHeight: 1,
      }}
    >
      <svg width={size} height={size} aria-hidden="true">
        <use href="/icons.svg#logo" />
      </svg>
      PoolFi
    </span>
  );
}
