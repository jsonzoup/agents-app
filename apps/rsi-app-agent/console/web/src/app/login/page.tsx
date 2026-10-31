"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/login", { body: { user: user.trim(), password } });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-white">
            <Sparkles className="size-5" />
          </div>
          <h1 className="text-xl font-semibold">自进化应用平台</h1>
        </div>
        <form onSubmit={signIn} className="grid gap-4 rounded-xl border bg-background p-6 shadow-sm">
          <div className="grid gap-2">
            <Label htmlFor="user">账号</Label>
            <Input id="user" autoComplete="username" autoFocus value={user} onChange={(e) => setUser(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">密码</Label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={busy || !user.trim() || !password}>
            {busy ? "登录中…" : "登录"}
          </Button>
          <p className="text-xs text-muted-foreground">忘记密码请联系系统管理员重置。</p>
        </form>
      </div>
    </div>
  );
}
