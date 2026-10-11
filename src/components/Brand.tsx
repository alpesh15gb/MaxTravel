import Image from "next/image";

export default function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`max-travel-brand${compact ? " max-travel-brand-compact" : ""}`}>
    <Image src="/brand/max-travel.png" width={2048} height={361} alt="Max Travel" priority sizes={compact ? "(max-width: 639px) 88px, 150px" : "220px"} />
    <span className="max-travel-brand-label">CRM</span>
  </span>;
}
