"use client";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { Check, CheckCheck, ShoppingBasket, CalendarPlus } from "lucide-react";
import { AISLES, formatAmount, type ShoppingItem, type ShoppingList } from "@/lib/domain";
import { setChecked } from "@/app/actions";
import { EmptyState, ErrorMessage } from "./ui";

function ShoppingRow({ item }: { item: ShoppingItem }) {
  const [checked, optimisticCheck] = useOptimistic(item.checked);
  const [pending, startTransition] = useTransition(); const [error, setError] = useState("");
  return <li className={`shopping-row ${checked ? "checked" : ""}`}><label className="shopping-label"><input type="checkbox" checked={checked} disabled={pending} aria-label={`${item.name}, ${formatAmount(item.quantity, item.unit)}`} onChange={event => { const target = event.target.checked; setError(""); startTransition(async () => { optimisticCheck(target); try { const result = await setChecked({ id: item.id, listId: item.list_id, checked: target }); if (!result.ok) setError(result.error); } catch { setError("Cet article n’a pas été enregistré. Vérifiez votre connexion et réessayez."); } }); }}/><span className="custom-checkbox" aria-hidden="true">{checked && <Check size={16} strokeWidth={3}/>}</span><span className="shopping-name">{item.name}</span><span className="shopping-amount">{formatAmount(item.quantity, item.unit)}</span></label>{error && <ErrorMessage>{error}</ErrorMessage>}</li>;
}
export function ShoppingListView({ list }: { list: ShoppingList | null }) {
  const checkedCount = list?.items.filter(item => item.checked).length ?? 0;
  const total = list?.items.length ?? 0; const finished = total > 0 && checkedCount === total;
  return <><div className="page-header"><div><p className="eyebrow">DIRECTION LE MARCHÉ</p><h1>Les courses<span className="heading-dot">.</span></h1><p>{list ? `Tout pour ${list.dish_count} plat${list.dish_count > 1 ? "s" : ""}, rangé par rayon.` : "La liste qui nous simplifie les courses."}</p></div>{list && <Link href="/preparer" className="button button-secondary"><CalendarPlus size={18}/> Préparer une nouvelle liste</Link>}</div>
    {!list ? <EmptyState icon={ShoppingBasket} title="Le panier attend ses petits plats." action={<Link href="/preparer" className="button button-primary"><CalendarPlus size={18}/> Choisir les plats</Link>}>Sélectionnez quelques recettes pour retrouver ici les ingrédients à acheter.</EmptyState> : <><div className={`shopping-progress ${finished ? "finished" : ""}`}><div className="progress-icon">{finished ? <CheckCheck size={25}/> : <ShoppingBasket size={25}/>}</div><div className="progress-copy"><strong>{finished ? "Tout est dans le caddie !" : "Notre panier se remplit"}</strong><span>{checkedCount} sur {total} articles cochés</span></div><div className="progress-track" role="progressbar" aria-label="Articles dans le caddie" aria-valuemin={0} aria-valuemax={total} aria-valuenow={checkedCount}><span style={{ width: `${total ? checkedCount / total * 100 : 0}%` }}/></div><strong className="progress-percent">{total ? Math.round(checkedCount / total * 100) : 0}%</strong></div>
      <div className="aisle-grid">{AISLES.map(aisle => { const items = list.items.filter(item => item.aisle === aisle.id); if (!items.length) return null; const complete = items.filter(item => item.checked).length; return <section className="aisle-panel" key={aisle.id}><div className="aisle-header"><span className="aisle-emoji" aria-hidden="true">{aisle.icon}</span><h2>{aisle.name}</h2><span className={complete === items.length ? "aisle-count complete" : "aisle-count"}>{complete}/{items.length}</span></div><ul>{items.map(item => <ShoppingRow key={item.id} item={item}/>)}</ul></section>; })}</div><p className="shopping-footnote">Cochez un article quand il est dans le caddie. Votre liste est enregistrée au fur et à mesure.</p>
    </>}
  </>;
}
