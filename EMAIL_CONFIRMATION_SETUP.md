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
