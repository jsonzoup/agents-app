"use client";

import * as React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

type Role = "林岚" | "陈宁" | "许悦";

interface RoleContextValue {
  role: Role;
  setRole: (role: Role) => void;
  readOnly: boolean;
}

const RoleContext = React.createContext<RoleContextValue>({ role: "林岚", setRole: () => {}, readOnly: false });

export function useRole() {
  return React.useContext(RoleContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = React.useState<Role>("林岚");

  React.useEffect(() => {
    const saved = window.localStorage.getItem("bgl-role") as Role | null;
    if (saved === "林岚" || saved === "陈宁" || saved === "许悦") setRoleState(saved);
  }, []);

  const setRole = React.useCallback((next: Role) => {
    setRoleState(next);
    window.localStorage.setItem("bgl-role", next);
  }, []);

  const value = React.useMemo(
    () => ({ role, setRole, readOnly: role === "许悦" }),
    [role, setRole],
  );

  return (
    <RoleContext.Provider value={value}>
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      <Toaster />
    </RoleContext.Provider>
  );
}
