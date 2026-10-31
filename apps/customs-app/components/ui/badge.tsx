import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        low: "border-[#EFCDC7] bg-[#FBF0EE] text-[#B23A2E]",
        warn: "border-[#F3D9A4] bg-[#FFF7E6] text-[#B45309]",
        good: "border-[#C6D3E2] bg-[#EDF2F8] text-[#16294A]",
        info: "border-[#CFDAE8] bg-[#EEF4FF] text-[#3B5BDB]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
