"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { hasSystem, manages, useSession } from "@/lib/session";

export default function Home() {
  const { me, apps } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (apps.length > 0) router.replace(`/use/${apps[0].name}`);
    else if (apps.some(manages) || hasSystem(me, "app.create")) router.replace("/manage");
    else if (hasSystem(me, "system.users")) router.replace("/system/users");
  }, [me, apps, router]);
  return apps.length === 0 && !hasSystem(me, "app.create") && !hasSystem(me, "system.users") ? (
    <p className="text-muted-foreground">你还没有任何应用的权限。请联系应用的管理者授权。</p>
  ) : null;
}
