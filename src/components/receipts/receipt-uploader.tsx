"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_MB = 10;
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

/** Camera-first on phones (rear camera), drag-and-drop or file picker on desktop. */
export function ReceiptUploader({ storeId }: { storeId: string }) {
  const router = useRouter();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [drag, setDrag] = useState(false);

  function send(file: File) {
    if (file.size > MAX_MB * 1024 * 1024) return toast.error(`File is larger than ${MAX_MB} MB`);
    if (!ACCEPT.split(",").includes(file.type)) return toast.error("Use a JPG, PNG or WebP photo, or a PDF");
    setBusy(true);
    setProgress(0);
    const form = new FormData();
    form.append("file", file);
    // XHR gives upload progress on slow mobile networks.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/v1/stores/${storeId}/receipts`);
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setBusy(false);
      const body = JSON.parse(xhr.responseText || "{}");
      if (xhr.status === 202) {
        if (body.data.duplicateOf) toast.warning("This looks like a receipt you already uploaded. Check before confirming.");
        else toast.success("Receipt uploaded. Reading it now…");
        router.push(`/receipts/${body.data.receipt.id}`);
      } else toast.error(body?.error?.message ?? "Upload failed");
    };
    xhr.onerror = () => {
      setBusy(false);
      toast.error("No internet connection. Try again when you are online.");
    };
    xhr.send(form);
  }

  const onFiles = (files: FileList | null) => files?.[0] && send(files[0]);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        onFiles(e.dataTransfer.files);
      }}
      className={cn("bg-card flex flex-col items-center gap-4 rounded-xl border-2 border-dashed p-6 text-center transition-colors", drag && "border-primary bg-primary/5")}
    >
      <div className="space-y-1">
        <p className="font-medium">Snap the supplier receipt or invoice</p>
        <p className="text-muted-foreground text-sm">KWADERNO reads the items. Nothing changes in your stock until you review and confirm.</p>
      </div>
      {busy ? (
        <div className="flex w-full max-w-xs flex-col items-center gap-2">
          <Loader2 className="text-primary size-6 animate-spin" />
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div className="bg-primary h-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-muted-foreground text-xs">Uploading… {progress}%</p>
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="lg" onClick={() => camera.current?.click()}><Camera /> Take photo</Button>
          <Button size="lg" variant="outline" onClick={() => picker.current?.click()}><FileUp /> Upload file</Button>
        </div>
      )}
      <p className="text-muted-foreground text-xs">JPG, PNG, WebP or PDF · up to {MAX_MB} MB · or drag a file here</p>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFiles(e.target.files)} />
      <input ref={picker} type="file" accept={ACCEPT} className="hidden" onChange={(e) => onFiles(e.target.files)} />
    </div>
  );
}
