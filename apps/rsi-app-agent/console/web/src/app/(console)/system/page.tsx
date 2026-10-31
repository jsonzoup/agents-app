"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SystemIndex() {
  const router = useRouter();
  useEffect(() => router.replace("/system/users"), [router]);
  return null;
}
