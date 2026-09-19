import Image from "next/image";

export function BrandMark({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const iconSize = compact ? 30 : 38;

  return (
    <span
      role="img"
      aria-label="FinePrint"
      className={`inline-flex items-center gap-2 leading-none ${className}`}
    >
      <Image
        src="/fineprint-mark.svg"
        width={iconSize}
        height={iconSize}
        alt=""
        aria-hidden="true"
        className="block shrink-0"
        preload={!compact}
      />
      <span
        aria-hidden="true"
        className={`${compact ? "translate-y-[3px] text-lg" : "text-xl"} font-bold tracking-[-0.035em]`}
      >
        <span className="text-brand-ink">Fine</span>
        <span className="text-brand-strong">Print</span>
      </span>
    </span>
  );
}
