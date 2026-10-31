"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { VersionPicker } from "@/components/version-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";

/** Download a version of the app as a zip: its code (with web/.env), the evaluation set and where it came from. */
export function ExportButton({ app, stable, size = "default" }: { app: string; stable: string; size?: "default" | "sm" }) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(stable);
  return (
    <>
      <Button variant="outline" size={size} onClick={() => (setVersion(stable), setOpen(true))}>
        <Download /> 导出压缩包
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导出应用</DialogTitle>
            <DialogDescription>压缩包里是这个版本的全部代码（技能、知识、契约、web 应用和它的 .env）、当前的评测集和导出信息。可以在另一个平台“导入压缩包”。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm font-medium">版本</div>
            <VersionPicker app={app} value={version} onChange={setVersion} className="h-9 w-full" />
            <p className="text-xs text-amber-700">web/.env 里可能有密钥，压缩包请妥善保管。</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button asChild onClick={() => setOpen(false)}>
              <a href={`/api/apps/${app}/export?version=${encodeURIComponent(version)}`} download>
                <Download /> 下载 {version}.zip
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Import an app archive: it opens an AI coding session with the archive as the workspace — a new
 * app when its name is free, a new version of the existing app otherwise — to check, test and publish.
 */
export function ImportButton({ label = "导入压缩包", variant = "outline" }: { label?: string; variant?: "outline" | "default" | "ghost" }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    setBusy(true);
    try {
      const s = await api<{ id: string; app: string; mode: "new" | "existing" }>(`/api/builds/import?name=${encodeURIComponent(file.name)}`, { raw: file });
      toast.success(s.mode === "new" ? `已导入为新应用 ${s.app}，检查、测试后发布` : `已导入为 ${s.app} 的新版本草稿，检查、测试后发布`);
      router.push(`/manage/build/${s.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <>
      <input ref={input} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <Button variant={variant} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <Upload />} {label}
      </Button>
    </>
  );
}
