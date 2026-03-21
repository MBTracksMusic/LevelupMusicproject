# Configuration de la confirmation d'email

## Activation dans Supabase Dashboard

Pour activer la confirmation d'email dans votre projet Supabase :

1. Connectez-vous à votre [Supabase Dashboard](https://supabase.com/dashboard)
2. Sélectionnez votre projet
3. Allez dans **Authentication** > **Settings** (dans la barre latérale)
4. Dans la section **Email Auth**, assurez-vous que :
   - **Enable email confirmations** est activé
   - **Secure email change** est activé (recommandé)
5. Cliquez sur **Save** pour enregistrer les modifications

## Configuration des templates d'email (optionnel)

Vous pouvez personnaliser les emails de confirmation :

1. Dans **Authentication** > **Email Templates**
2. Sélectionnez **Confirm signup**
3. Personnalisez le template selon vos besoins
4. Assurez-vous que le lien de confirmation pointe vers : `{{ .ConfirmationURL }}`

## Configuration recommandee: Send Email Hook

Pour reprendre le controle complet des emails Auth avec Resend:

1. Deployez la fonction Edge:
   `supabase functions deploy auth-send-email --no-verify-jwt`
2. Ouvrez **Auth > Hooks > Send Email**
3. Creez un hook HTTPS pointant vers l'URL de `auth-send-email`
4. Generez le secret du hook
5. Ajoutez les secrets Supabase:
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL="Beatelion <contact@beatelion.com>"`
   - `SEND_EMAIL_HOOK_SECRET="v1,whsec_..."`

Ce hook envoie les emails Auth via le meme systeme Resend/logging que les autres emails applicatifs.

## Validation manuelle avant lancement

Verifier au minimum:

1. l'email de confirmation d'inscription arrive
2. l'email de reinitialisation arrive
3. le lien ouvre correctement l'application
4. le token fonctionne
5. aucun doublon n'est envoye pour la meme action
6. `provider_message_id` est present dans les logs
7. l'email n'affiche pas de lien de desinscription

## Flux d'inscription avec confirmation

Une fois configuré, le flux d'inscription fonctionne ainsi :

1. L'utilisateur s'inscrit via `/register`
2. Il est redirigé vers `/email-confirmation?email=...`
3. Un email est envoyé avec un lien de confirmation
4. L'utilisateur clique sur le lien dans l'email
5. Il est redirigé vers `/email-confirmation` avec un token
6. La confirmation est validée automatiquement
7. L'utilisateur est connecté et redirigé vers la page d'accueil

## Vérification lors de la connexion

Si un utilisateur tente de se connecter sans avoir confirmé son email :
- Il sera redirigé vers `/email-confirmation`
- Un message lui indiquera de vérifier son email
- Il pourra renvoyer l'email de confirmation si nécessaire

## Test en local

Pour tester en local sans configuration SMTP :

1. Dans le Supabase Dashboard, allez dans **Authentication** > **Settings**
2. Désactivez temporairement **Enable email confirmations** pour les tests
3. Ou utilisez la fonctionnalité "Inbucket" dans le Supabase Local Dev (si vous utilisez la CLI locale)

## Pages créées

- `/email-confirmation` : Page affichant l'état de la confirmation
  - Affiche un message en attente si l'email n'est pas encore confirmé
  - Traite automatiquement la confirmation quand l'utilisateur clique sur le lien
  - Permet de renvoyer l'email de confirmation
  - Affiche le succès ou l'erreur de la confirmation
