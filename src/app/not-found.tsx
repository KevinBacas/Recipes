import Link from "next/link";
export default function NotFound() { return <main id="main" className="empty-state"><h1>Cette page n’est plus à la carte.</h1><p>Retrouvez vos recettes et vos courses dans votre espace.</p><Link href="/recettes" className="button button-primary">Retour aux recettes</Link></main>; }
