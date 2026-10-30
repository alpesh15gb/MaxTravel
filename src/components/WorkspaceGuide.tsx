"use client";
import { useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import Modal from "./Modal";
import { screenGuide } from "@/lib/workspace-guide";

export default function WorkspaceGuide({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const guide = screenGuide(path);
  if (!guide || path.startsWith("/payments/print")) return null;
  return <>
    <div className="workspace-orientation no-print">
      <nav aria-label="Breadcrumb"><Link href="/dashboard">Workspace</Link><span aria-hidden="true">/</span>{guide.parent && <><Link href={guide.parent.href}>{guide.parent.label}</Link><span aria-hidden="true">/</span></>}<span aria-current="page">{guide.title}</span></nav>
      <button type="button" className="screen-guide-trigger" onClick={() => setOpen(true)}><Icon name="compass" size={16}/>Screen guide</button>
    </div>
    {open && <Modal labelledBy="screen-guide-title" onClose={() => setOpen(false)}>
      <div className="guide-dialog"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">{guide.area}</p><h2 id="screen-guide-title">{guide.title}</h2></div><button className="icon-button" aria-label="Close screen guide" onClick={() => setOpen(false)}><Icon name="close"/></button></div><p>Follow the work in this order.</p><ol>{guide.steps.map((step,index) => <li key={step}><span>{index+1}</span><p>{step}</p></li>)}</ol><Link className="btn-secondary" href="/work" onClick={() => setOpen(false)}>Find another workflow<Icon name="arrow" size={16}/></Link></div>
    </Modal>}
  </>;
}
