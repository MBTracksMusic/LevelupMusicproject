export function Faq() {
  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-4xl mx-auto px-4 space-y-8">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-white">FAQ</h1>
          <p className="text-zinc-400">Questions frequentes sur l&apos;utilisation de la plateforme.</p>
        </div>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold text-white">Pour les utilisateurs</h2>
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="text-lg font-medium text-white">Comment acheter un beat ?</h3>
              <p className="text-zinc-400">
                Selectionnez le produit souhaite, ajoutez-le au panier puis finalisez le paiement via Stripe.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-medium text-white">Ou trouver mes achats ?</h3>
              <p className="text-zinc-400">
                Vos achats et acces associes sont disponibles dans votre tableau de bord utilisateur.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-medium text-white">Puis-je voter et commenter les battles ?</h3>
              <p className="text-zinc-400">
                Oui, selon les regles d&apos;eligibilite du compte et le statut de la battle en cours.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold text-white">Pour les producteurs</h2>
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="text-lg font-medium text-white">Comment activer mon compte producteur ?</h3>
              <p className="text-zinc-400">
                Souscrivez a l&apos;offre producteur puis verifiez que votre statut est actif dans votre espace compte.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-medium text-white">Comment publier mes contenus ?</h3>
              <p className="text-zinc-400">
                Depuis l&apos;espace producteur, chargez vos fichiers, renseignez les metadonnees puis publiez vos
                produits.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-medium text-white">Comment sont gerees les ventes ?</h3>
              <p className="text-zinc-400">
                Les paiements et abonnements sont traites via Stripe, avec synchronisation serveur et webhooks.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
