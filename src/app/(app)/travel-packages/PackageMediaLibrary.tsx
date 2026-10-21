"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
type Asset = { id: string; url: string; previewUrl: string; width: number; height: number; byteSize: number };
export default function PackageMediaLibrary({ packageId, disabled, onCover, onGallery, galleryFull, selectedCover }: { packageId?: string; disabled: boolean; onCover: (url: string) => void; onGallery: (url: string) => void; galleryFull: boolean; selectedCover: string }) {
  const [assets, setAssets] = useState<Asset[]>([]), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null), lock = useRef(false);
  async function load() {
    if (!packageId) return;
    setLoading(true); setError("");
    try { const response = await fetch(`/api/travel-packages/${packageId}/media`, { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw Error(body.error || "Images could not be loaded."); setAssets(body.images); setUncertain(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Images could not be loaded."); }
    finally { setLoading(false); }
  }
  useEffect(() => { setAssets([]); void load(); }, [packageId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function upload(file: File | undefined) {
    if (!file || !packageId || lock.current || disabled || uncertain) return;
    if (file.size > 5 * 1024 * 1024) { setError("Choose an image smaller than 5 MiB."); if (input.current) input.current.value = ""; return; }
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch(`/api/travel-packages/${packageId}/media`, { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) { if (response.status >= 500) setUncertain(true); throw Error(body.error || "Upload could not be completed. Reload the image library before retrying."); }
      setAssets(current => [body.image, ...current]); setNotice("Image uploaded privately. Choose it as a cover or gallery image to add it to this draft.");
    } catch (e) { setUncertain(true); setError(e instanceof TypeError || e instanceof SyntaxError ? "The upload response was interrupted. Your image may have been saved. Reload the image library before trying again." : e instanceof Error ? e.message : "Upload response was not received. Reload the library to check whether the image was saved before retrying."); }
    finally { lock.current = false; setBusy(false); if (input.current) input.current.value = ""; }
  }
  return <section className="min-w-0 max-w-full space-y-4 rounded-xl border border-slate-200 p-4" aria-labelledby="package-media-title">
    <div><h3 id="package-media-title" className="text-base font-semibold">Your package image library</h3><p className="mt-1 text-sm text-slate-600">Upload images you own or have permission to publish. JPEG, PNG or still WebP · 5 MiB / 20 megapixels maximum · up to 24 images. Images are stripped of metadata and resized. Uploads stay private until selected in a published version.</p></div>
    {!packageId ? <p className="text-sm text-amber-800">Save this draft first to upload your own images.</p> : <>
      <label className="block text-sm font-medium" htmlFor="package-image-upload">Upload package image</label><input ref={input} id="package-image-upload" className="control min-w-0 w-full max-w-full" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy || loading || uncertain || !!error || assets.length >= 24} onChange={event => void upload(event.target.files?.[0])} />
      {notice && <p role="status" className="text-sm text-teal-800">{notice}</p>}
      {assets.length >= 24 && <p className="text-sm text-amber-800">This package has reached its 24-image limit. You can continue using the existing images.</p>}
      {busy && <p role="status" className="text-sm">Checking and processing your image…</p>}
      {loading && <p role="status" className="text-sm">Loading image library…</p>}
      {error && <div role="alert" className="form-error"><p>{error}</p><button type="button" className="btn-secondary mt-2" disabled={busy || loading} onClick={() => void load()}>Reload image library</button></div>}
      {!loading && !error && !assets.length && <p className="text-sm text-slate-500">No images uploaded yet. You can also use an approved public image URL below.</p>}
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{assets.map((asset, index) => <div key={asset.id} className="min-w-0 overflow-hidden rounded-xl border border-slate-200"><Image unoptimized src={asset.previewUrl} alt={`Uploaded package image ${index + 1}`} width={asset.width} height={asset.height} className="aspect-[4/3] w-full object-cover" /><div className="space-y-2 p-3"><p id={`media-caption-${asset.id}`} className="text-xs text-slate-500">Image {index + 1} · {asset.width} × {asset.height} · {Math.ceil(asset.byteSize / 1024)} KiB</p><div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" disabled={disabled || busy} aria-describedby={`media-caption-${asset.id}`} aria-pressed={selectedCover === asset.url} onClick={() => { onCover(asset.url); setNotice(`Image ${index + 1} selected as the draft cover. Add its description below before publishing.`); }}>Use as cover</button><button type="button" className="btn-secondary" disabled={disabled || busy || galleryFull} aria-describedby={`media-caption-${asset.id}`} onClick={() => { onGallery(asset.url); setNotice(`Image ${index + 1} added to the draft gallery. Add its description below before publishing.`); }}>Add to gallery</button></div></div></div>)}</div>
      <p className="text-sm text-slate-500">Choosing an image changes this draft only. Add an accessible description below, save, then publish when ready. Removing an image from the draft does not delete the stored image or change the published version.</p>
    </>}
  </section>;
}
