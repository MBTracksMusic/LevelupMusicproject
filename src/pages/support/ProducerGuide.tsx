export function ProducerGuide() {
  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-4xl mx-auto px-4 space-y-8">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-white">Guide du producteur</h1>
          <p className="text-zinc-400">
            Retrouvez les etapes essentielles pour publier, vendre et maintenir un compte producteur conforme.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">Creer un compte producteur</h2>
          <p className="text-zinc-400">
            Commencez par creer votre compte, completer votre profil public et souscrire a l&apos;offre producteur
            active.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">Soumettre un produit</h2>
          <p className="text-zinc-400">
            Uploadez votre contenu avec metadonnees completes (titre, type, prix, visuel, tags) et assurez-vous que
            les elements audio respectent les standards de la plateforme.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">Validation</h2>
          <p className="text-zinc-400">
            Les produits et contenus peuvent etre verifies pour garantir la qualite, la conformite legale et le
            respect des regles communautaires.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">Commission &amp; paiements</h2>
          <p className="text-zinc-400">
            Les paiements sont traites via Stripe. Les revenus, commissions et statuts de transactions sont
            consultables depuis votre espace producteur.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">Regles &amp; sanctions</h2>
          <p className="text-zinc-400">
            Toute violation des conditions (contenu interdit, fraude, usurpation, non-respect des licences) peut
            entrainer des restrictions, une suspension temporaire ou definitive du compte.
          </p>
        </section>
      </div>
    </div>
  );
}
