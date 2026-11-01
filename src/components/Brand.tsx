import Image from "next/image";

export default function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`max-travel-brand${compact ? " max-travel-brand-compact" : ""}`}>
    <Image src="/brand/maxtravel-logo.jpg" width={1600} height={324} alt="MaxTravel — Your one-stop travel solution" loading="eager" fetchPriority="low" sizes={compact ? "(max-width: 639px) 88px, 150px" : "220px"} />
    <span className="max-travel-brand-label">CRM</span>
  </span>;
}
