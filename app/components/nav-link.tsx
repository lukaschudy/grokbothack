"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path.startsWith(href);
  return (
    <Link href={href} className={className} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}
