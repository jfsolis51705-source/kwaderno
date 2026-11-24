"use client";
import * as React from "react";
import { Dialog as P } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = P.Root;
const SheetTrigger = P.Trigger;
const SheetClose = P.Close;

function SheetContent({ className, children, side = "right", ...props }: React.ComponentProps<typeof P.Content> & { side?: "left" | "right" | "bottom" }) {
  return (
    <P.Portal>
      <P.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50" />
      <P.Content
        className={cn(
          "bg-card data-[state=open]:animate-in fixed z-50 flex flex-col gap-4 shadow-lg",
          side === "right" && "data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
          side === "left" && "data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
          side === "bottom" && "data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl border-t",
          className,
        )}
        {...props}
      >
        {children}
        <P.Close className="absolute top-4 right-4 rounded-xs opacity-70 hover:opacity-100">
          <XIcon className="size-5" />
          <span className="sr-only">Close</span>
        </P.Close>
      </P.Content>
    </P.Portal>
  );
}
const SheetHeader = ({ className, ...props }: React.ComponentProps<"div">) => <div className={cn("flex flex-col gap-1.5 p-4", className)} {...props} />;
const SheetTitle = ({ className, ...props }: React.ComponentProps<typeof P.Title>) => <P.Title className={cn("font-semibold", className)} {...props} />;
const SheetDescription = ({ className, ...props }: React.ComponentProps<typeof P.Description>) => (
  <P.Description className={cn("text-muted-foreground text-sm", className)} {...props} />
);
export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription };
