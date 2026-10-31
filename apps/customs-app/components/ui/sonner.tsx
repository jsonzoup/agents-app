"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      toastOptions={{
        style: {
          background: "#1A1D21",
          color: "#fff",
          border: "none",
          fontSize: "12.5px",
          borderRadius: "10px",
        },
      }}
    />
  );
}
