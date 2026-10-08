"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarPlus, ShoppingBasket, LogOut, CookingPot, Heart } from "lucide-react";
import { signOut } from "@/app/actions";
import clsx from "clsx";
import { useState, useTransition } from "react";
import { ErrorMessage, Spinner } from "./ui";

const links = [{ href: "/recettes", label: "Recettes", icon: BookOpen }, { href: "/preparer", label: "Préparer", icon: CalendarPlus }, { href: "/courses", label: "Courses", icon: ShoppingBasket }];

function LogoutButton({ mobile = false }: { mobile?: boolean }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const className = mobile ? "icon-button" : "logout";

  return <>
    <button
      type="button"
      className={className}
      aria-label={mobile ? "Se déconnecter" : undefined}
      disabled={pending}
      onClick={() => startTransition(async () => {
        setError("");
        const result = await signOut();
        if (!result.ok) setError(result.error);
      })}
    >
      {pending ? <Spinner/> : <LogOut size={16}/>} {mobile ? null : "Se déconnecter"}
    </button>
    {error && <ErrorMessage>{error}</ErrorMessage>}
  </>;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/recettes" className="brand" aria-label="À table, accueil"><span className="brand-mark"><CookingPot size={23}/></span><span>à table<span className="brand-dot">.</span></span></Link>
      <div className="workspace-label"><Heart size={13}/> Notre cuisine</div>
      <nav className="desktop-nav" aria-label="Navigation principale">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={clsx("nav-link", path.startsWith(href) && "active")} aria-current={path.startsWith(href) ? "page" : undefined}><Icon size={20}/>{label}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="household"><span className="avatar">N</span><div><strong>Notre espace</strong><span>Une cuisine à deux</span></div></div><LogoutButton/></div>
    </aside>
    <header className="mobile-header"><Link href="/recettes" className="brand"><span className="brand-mark"><CookingPot size={20}/></span><span>à table<span className="brand-dot">.</span></span></Link><LogoutButton mobile/></header>
    <main className="main-content" id="main">{children}</main>
    <nav className="bottom-nav" aria-label="Navigation principale">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={clsx(path.startsWith(href) && "active")} aria-current={path.startsWith(href) ? "page" : undefined}><Icon size={22}/><span>{label}</span></Link>)}</nav>
  </div>;
}
