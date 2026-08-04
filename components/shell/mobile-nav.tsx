"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { Logo } from "@/components/shell/logo";
import { SidebarNav } from "@/components/shell/sidebar";
import { StudioSwitcher } from "@/components/shell/studio-switcher";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** The sidebar, in a drawer, below `lg`. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Navigating should close the drawer.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden">
          <Menu />
          <span className="sr-only">Open navigation</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex flex-col p-0">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="flex flex-col gap-3 px-3 pb-1 pt-4">
          <div className="px-1">
            <Logo />
          </div>
          <StudioSwitcher />
        </div>
        <SidebarNav />
      </SheetContent>
    </Sheet>
  );
}
