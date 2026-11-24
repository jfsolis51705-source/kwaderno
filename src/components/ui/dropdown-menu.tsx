"use client";
import * as React from "react";
import { DropdownMenu as P } from "radix-ui";
import { cn } from "@/lib/utils";

const DropdownMenu = P.Root;
const DropdownMenuTrigger = P.Trigger;
function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        sideOffset={sideOffset}
        className={cn("bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=open]:fade-in-0 z-50 min-w-[12rem] overflow-hidden rounded-md border p-1 shadow-md", className)}
        {...props}
      />
    </P.Portal>
  );
}
function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof P.Item>) {
  return (
    <P.Item
      className={cn("focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-hidden select-none data-[disabled]:opacity-50 [&_svg]:size-4", className)}
      {...props}
    />
  );
}
const DropdownMenuLabel = ({ className, ...props }: React.ComponentProps<typeof P.Label>) => <P.Label className={cn("px-2 py-1.5 text-sm font-medium", className)} {...props} />;
const DropdownMenuSeparator = ({ className, ...props }: React.ComponentProps<typeof P.Separator>) => <P.Separator className={cn("bg-border -mx-1 my-1 h-px", className)} {...props} />;
export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator };
