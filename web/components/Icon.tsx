/**
 * Inline stroke icons.
 *
 * Every category pairs its color with one of these shapes and a text label,
 * so identity survives colorblindness, grayscale printing and forced-colors
 * mode. The shapes are deliberately dissimilar from one another for the same
 * reason.
 */

export type IconName =
  | "gift"
  | "loan"
  | "work"
  | "unclear"
  | "cost"
  | "later"
  | "total"
  | "missing"
  | "unverified"
  | "upload"
  | "document"
  | "arrow-right"
  | "check"
  | "spark"
  | "user";

const PATHS: Record<IconName, React.ReactNode> = {
  // A wrapped box: money given, not lent.
  gift: (
    <>
      <rect x="3.5" y="8.5" width="17" height="4" rx="1" />
      <path d="M5 12.5v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
      <path d="M12 8.5v12" />
      <path d="M12 8.5c-1.8-3.6-5.5-3.8-5.5-1.4 0 1.4 2.4 1.4 5.5 1.4Z" />
      <path d="M12 8.5c1.8-3.6 5.5-3.8 5.5-1.4 0 1.4-2.4 1.4-5.5 1.4Z" />
    </>
  ),
  // An arrow that returns: money that goes back.
  loan: (
    <>
      <path d="M20 8H9a5 5 0 0 0 0 10h6" />
      <path d="m16.5 4.5 3.5 3.5-3.5 3.5" />
    </>
  ),
  // A clock: money paid for hours worked.
  work: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  unclear: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.2-2.5 3.9" />
      <path d="M12 16.9h.01" />
    </>
  ),
  cost: (
    <>
      <path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4Z" />
      <path d="M9 8.5h6M9 12h6M9 15.5h3" />
    </>
  ),
  later: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="1.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="M12.5 13.5h3.5v3.5" />
    </>
  ),
  total: (
    <>
      <path d="M17.5 5H6.5l6 7-6 7h11" />
    </>
  ),
  missing: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 2.4" />
      <path d="M12 8.5v4.5M12 16h.01" />
    </>
  ),
  unverified: (
    <>
      <path d="M12 3.5 20.5 19H3.5Z" />
      <path d="M12 9.5v4M12 16.5h.01" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  document: (
    <>
      <path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8Z" />
      <path d="M14 3.5V8h4.5M9 12.5h6M9 16h4" />
    </>
  ),
  "arrow-right": <path d="M5 12h14m-5-5 5 5-5 5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  spark: (
    <path d="M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8Z" />
  ),
  // A person: a value the student supplied, not one read from the letter.
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  className,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  /** Provide only when the icon carries meaning not stated in adjacent text. */
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
