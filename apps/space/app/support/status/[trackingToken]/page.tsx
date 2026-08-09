/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Circle, Clock3, FileText, LoaderCircle, MessageSquare, Paperclip, Send, XCircle } from "lucide-react";
import { IntakeService } from "@plane/services";
import type { TPublicIntakeTracking } from "@plane/types";
import { cn } from "@plane/utils";
import type { Route } from "./+types/page";
import { formatBytes, getInitialSupportLocale, SUPPORT_COPY, type TSupportLocale } from "../../intake-copy";

const service = new IntakeService();
const STATUS_ORDER = ["RECEIVED", "UNDER_REVIEW", "IN_PROGRESS", "COMPLETED"] as const;

export default function PublicIntakeTrackingPage({ params }: Route.ComponentProps) {
  const { trackingToken } = params;
  const [locale, setLocale] = useState<TSupportLocale>("ru");
  const [data, setData] = useState<TPublicIntakeTracking | null>(null);
  const [missing, setMissing] = useState(false);
  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const copy = SUPPORT_COPY[locale];
  const load = useCallback(async () => { try { setData(await service.getPublicTracking(trackingToken)); } catch { setMissing(true); } }, [trackingToken]);
  useEffect(() => { setLocale(getInitialSupportLocale()); void load(); const interval = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(interval); }, [load]);

  const uploadFiles = async () => {
    const ids: string[] = [];
    for (const file of files) {
      // Upload sequentially so project limits are validated before every file.
      // eslint-disable-next-line no-await-in-loop
      const prepared = await service.prepareTrackingAsset(trackingToken, { name: file.name, type: file.type || "application/octet-stream", size: file.size });
      const body = new FormData();
      Object.entries(prepared.upload_data.fields).forEach(([key, value]) => body.append(key, value));
      body.append("file", file);
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(prepared.upload_data.url, { method: "POST", body });
      if (!response.ok) throw new Error("UPLOAD_FAILED");
      // eslint-disable-next-line no-await-in-loop
      await service.completeTrackingAsset(trackingToken, prepared.asset_id);
      ids.push(prepared.asset_id);
    }
    return ids;
  };

  const send = async () => {
    if (!comment.trim() && !files.length) return;
    setSending(true);
    try {
      const assetIds = await uploadFiles();
      const escaped = comment.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] || char).replace(/\n/g, "<br>");
      const html = comment.trim() ? `<p>${escaped}</p>` : `<p>${copy.attachmentComment}</p>`;
      setData(await service.commentOnPublicTracking(trackingToken, { comment_html: html, asset_ids: assetIds }));
      setComment("");
      setFiles([]);
    } finally {
      setSending(false);
    }
  };

  if (!data) {
    return <main className="flex min-h-screen items-center justify-center bg-[#0d1211] text-white">{missing ? <div className="text-center"><XCircle className="mx-auto size-8 text-white/35" /><h1 className="mt-4 text-20 font-semibold">{copy.unavailableTitle}</h1><p className="mt-2 text-13 text-white/50">{copy.unavailableHelp}</p></div> : <LoaderCircle className="size-6 animate-spin text-white/50" />}</main>;
  }

  const currentIndex = data.public_status === "REJECTED" ? -1 : STATUS_ORDER.indexOf(data.public_status as typeof STATUS_ORDER[number]);
  return (
    <main className="min-h-screen bg-[#0d1211] px-5 py-6 text-white">
      <header className="mx-auto flex max-w-4xl items-center justify-between"><div className="flex items-center gap-2 text-13 font-semibold"><div className="flex size-8 items-center justify-center rounded-lg bg-emerald-600"><Send className="size-4" /></div>GTS SYSTEM</div><div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-1">{(["ru", "uz", "en"] as const).map((item) => <button type="button" key={item} onClick={() => setLocale(item)} className={cn("rounded-md px-2.5 py-1 text-11 uppercase", locale === item ? "bg-white/10" : "text-white/40")}>{item}</button>)}</div></header>
      <div className="mx-auto mt-10 max-w-4xl">
        <div className="rounded-2xl border border-white/10 bg-[#171d1b] p-6 sm:p-8"><div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2 text-12 text-emerald-300"><CheckCircle2 className="size-4" />{copy.received}</div><h1 className="mt-3 text-24 font-semibold sm:text-30">{data.title}</h1><p className="mt-2 font-mono text-12 text-white/45">{data.reference}</p>{data.success_message && <p className="mt-4 max-w-xl text-13 leading-5 text-white/60">{data.success_message}</p>}</div><div className={cn("w-fit rounded-full px-3 py-1.5 text-12 font-medium", data.public_status === "REJECTED" ? "bg-red-400/10 text-red-300" : "bg-emerald-400/10 text-emerald-300")}>{copy.statuses[data.public_status]}</div></div><div className="mt-8 grid grid-cols-4 gap-1">{STATUS_ORDER.map((item, index) => <div key={item}><div className={cn("h-1 rounded-full", index <= currentIndex ? "bg-emerald-500" : "bg-white/10")} /><div className={cn("mt-2 text-10 sm:text-11", index <= currentIndex ? "text-white/70" : "text-white/30")}>{copy.statuses[item]}</div></div>)}</div></div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_300px]">
          <section className="rounded-2xl border border-white/10 bg-[#171d1b] p-5"><h2 className="flex items-center gap-2 text-14 font-semibold"><MessageSquare className="size-4 text-white/45" />{copy.comments}</h2><div className="mt-4 space-y-3">{data.comments.length ? data.comments.map((item) => <div key={item.id} className="rounded-xl bg-white/[0.035] p-3"><div className="flex justify-between gap-3 text-10 text-white/40"><span>{item.author}</span><span>{new Date(item.created_at).toLocaleString(locale)}</span></div><div className="prose prose-invert mt-2 max-w-none text-13 text-white/75" dangerouslySetInnerHTML={{ __html: item.comment_html }} /></div>) : <p className="py-6 text-center text-12 text-white/35">{copy.noComments}</p>}</div><div className="mt-5 border-t border-white/10 pt-4"><textarea className="h-24 w-full rounded-xl border border-white/10 bg-white/[0.035] p-3 text-13 outline-none focus:border-emerald-500/60" value={comment} onChange={(event) => setComment(event.target.value)} placeholder={copy.addComment} /><div className="mt-2 flex items-center justify-between"><div><button type="button" onClick={() => fileInput.current?.click()} className="flex items-center gap-1.5 text-11 text-white/45 hover:text-white/70"><Paperclip className="size-3.5" />{files.length ? `${files.length} ${copy.files}` : copy.files}</button><input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => event.target.files && setFiles(Array.from(event.target.files))} /></div><button type="button" disabled={sending || (!comment.trim() && !files.length)} onClick={() => void send()} className="flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-12 font-semibold disabled:opacity-50">{sending && <LoaderCircle className="size-3.5 animate-spin" />}{copy.sendComment}</button></div></div></section>
          <aside className="space-y-5"><div className="rounded-2xl border border-white/10 bg-[#171d1b] p-5"><h2 className="flex items-center gap-2 text-14 font-semibold"><Clock3 className="size-4 text-white/45" />{copy.updates}</h2><div className="mt-4 space-y-4">{data.events.map((event, index) => <div key={event.id} className="flex gap-3"><div className="mt-0.5">{index === 0 ? <Check className="size-3.5 text-emerald-400" /> : <Circle className="size-3.5 text-white/25" />}</div><div><div className="text-11 text-white/65">{event.public_status ? copy.statuses[event.public_status as keyof typeof copy.statuses] : event.message || copy.events[event.event_type as keyof typeof copy.events] || event.event_type}</div><div className="mt-0.5 text-10 text-white/30">{new Date(event.created_at).toLocaleString(locale)}</div></div></div>)}</div></div>{data.attachments.length > 0 && <div className="rounded-2xl border border-white/10 bg-[#171d1b] p-5"><h2 className="flex items-center gap-2 text-14 font-semibold"><Paperclip className="size-4 text-white/45" />{copy.attachments}</h2><div className="mt-3 space-y-2">{data.attachments.map((asset) => <a key={asset.id} href={`/api/public/support/status/${trackingToken}/assets/${asset.id}/download/`} className="flex items-center gap-2 rounded-lg bg-white/[0.035] p-2.5 text-11 hover:bg-white/[0.06]"><FileText className="size-4 text-white/40" /><span className="min-w-0 flex-1 truncate">{asset.name}</span><span className="text-white/30">{formatBytes(asset.size)}</span></a>)}</div></div>}</aside>
        </div>
      </div>
    </main>
  );
}
