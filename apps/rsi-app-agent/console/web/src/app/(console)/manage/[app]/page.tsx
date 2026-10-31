"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loading } from "@/components/shell/page";
import { useApp } from "@/lib/session";

export default function ManageAppIndex() {
  const { app } = useApp();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/manage/${app.name}/code`);
  }, [app, router]);
  return <Loading />;
}
