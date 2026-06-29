"use client";

/** Color palette for borrower avatars — consistent hash → color. */
const AVATAR_COLORS = [
  { bg: "#d1fae5", text: "#065f46" }, // green
  { bg: "#dbeafe", text: "#1e40af" }, // blue
  { bg: "#ede9fe", text: "#5b21b6" }, // purple
  { bg: "#fce7f3", text: "#9d174d" }, // pink
  { bg: "#cffafe", text: "#0e7490" }, // cyan
  { bg: "#fef3c7", text: "#92400e" }, // amber
  { bg: "#ffedd5", text: "#9a3412" }, // orange
  { bg: "#f0fdf4", text: "#166534" }, // light green
  { bg: "#e0f2fe", text: "#075985" }, // sky
  { bg: "#f3e8ff", text: "#6b21a8" }, // violet
  { bg: "#fdf4ff", text: "#86198f" }, // fuchsia
  { bg: "#ecfdf5", text: "#047857" }, // emerald
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h;
}

function getInitials(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const f = (firstName ?? "").trim();
  const l = (lastName ?? "").trim();
  if (f && l) return `${f[0]}${l[0]}`.toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  if (l) return l.slice(0, 2).toUpperCase();
  return "?";
}

type Props = {
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  size?: number;
};

export function BorrowerAvatar({ firstName, lastName, size = 34 }: Props) {
  const initials = getInitials(firstName, lastName);
  const fullName = `${firstName ?? ""}${lastName ?? ""}`;
  const palette = AVATAR_COLORS[hashName(fullName) % AVATAR_COLORS.length];

  return (
    <span
      style={{
        width: size,
        height: size,
        minWidth: size,
        background: palette.bg,
        color: palette.text,
        fontSize: size * 0.35,
      }}
      className="inline-flex items-center justify-center rounded-full font-bold leading-none select-none"
      aria-hidden
    >
      {initials}
    </span>
  );
}
