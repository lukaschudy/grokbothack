"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const path = usePathname();
  const route = href.split("#")[0] || "/";
  const active = route === "/" ? path === "/" : path.startsWith(route);
  return (
    <Link href={href} className={className} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}
