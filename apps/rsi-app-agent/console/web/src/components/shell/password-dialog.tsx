"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

export const MIN_PASSWORD = 6;

/**
 * Set a password. Without `target` it changes the signed-in user's own password (asks for the
 * current one); with `target` a system administrator sets that user's password.
 */
export function PasswordDialog({
  open,
  onOpenChange,
  target,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target?: { id: string; name: string };
  onSaved?: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close(o: boolean) {
    if (!o) {
      setCurrent("");
      setNext("");
      setAgain("");
      setError(null);
    }
    onOpenChange(o);
  }

  const problem = next.length > 0 && next.length < MIN_PASSWORD ? `密码至少 ${MIN_PASSWORD} 位` : again.length > 0 && again !== next ? "两次输入的新密码不一致" : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (target) await api(`/api/system/users/${encodeURIComponent(target.id)}/password`, { body: { password: next } });
      else await api("/api/me/password", { body: { current, password: next } });
      toast.success(target ? `已重置 ${target.name} 的密码，对方需要用新密码重新登录` : "密码已修改");
      onSaved?.();
      close(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{target ? `重置 ${target.name} 的密码` : "修改密码"}</DialogTitle>
            <DialogDescription>{target ? "保存后对方已登录的会话会失效。" : "保存后其他设备上的登录会失效。"}</DialogDescription>
          </DialogHeader>
          {!target && (
            <div className="grid gap-2">
              <Label htmlFor="pw-current">当前密码</Label>
              <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="pw-next">新密码</Label>
            <Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw-again">再输入一次</Label>
            <Input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
          </div>
          {(problem || error) && (
            <Alert variant="destructive">
              <AlertDescription>{problem ?? error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy || problem !== null || next.length < MIN_PASSWORD || next !== again || (!target && !current)}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
