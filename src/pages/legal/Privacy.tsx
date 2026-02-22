export function Privacy() {
  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-4xl mx-auto px-4 space-y-8">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-white">Politique de confidentialite</h1>
          <p className="text-zinc-400">
            Cette page decrit les categories de donnees traitees et la maniere dont elles sont protegees.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">Donnees collectees</h2>
          <p className="text-zinc-400">
            Nous collectons les informations necessaires au fonctionnement du compte, aux paiements et a la securite
            de la plateforme.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">Utilisation des donnees</h2>
          <p className="text-zinc-400">
            Les donnees servent a gerer l&apos;authentification, les transactions, le support et l&apos;amelioration du service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">Stockage (Supabase)</h2>
          <p className="text-zinc-400">
            Les donnees applicatives sont hebergees via Supabase avec controles d&apos;acces, RLS et separation des roles.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">Paiements (Stripe)</h2>
          <p className="text-zinc-400">
            Les paiements sont traites par Stripe. Les informations bancaires sensibles ne sont pas stockees par
            l&apos;application.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">Securite</h2>
          <p className="text-zinc-400">
            Des mesures techniques et organisationnelles sont appliquees pour reduire les risques d&apos;acces non autorise
            ou de fuite.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">Droits RGPD</h2>
          <p className="text-zinc-400">
            Vous pouvez exercer vos droits d&apos;acces, rectification, opposition, limitation et suppression selon le cadre
            legal en vigueur.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">Contact</h2>
          <p className="text-zinc-400">
            Pour toute demande relative a vos donnees personnelles, utilisez les canaux de support prevus par la
            plateforme.
          </p>
        </section>
      </div>
    </div>
  );
}
