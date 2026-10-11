"use client";
export default function PrintButton() {
  return <button className="btn-primary no-print" onClick={() => window.print()}>Print / save as PDF</button>;
}
