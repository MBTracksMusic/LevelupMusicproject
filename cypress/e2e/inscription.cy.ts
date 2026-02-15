describe('inscription', () => {
  it('passes', () => {
    cy.visit('http://localhost:5173/')
  })
});

it('modifier parametre', function() {
  // Connexion
  cy.visit('http://localhost:5173/login');
  cy.get('#root input[type="email"]').type('ludovic.ousselin@gmail.com');
  cy.get('#root input[type="password"]').type('warrior971');
  cy.get('#root button.w-full').click();

  // Accède ensuite aux paramètres une fois connecté
  cy.visit('http://localhost:5173/settings');

  // Le seul champ requis dans l’onglet Profil est le username
  cy.get('#root input[required]').first().clear().type('Ludo971');
  cy.contains('button', 'Enregistrer les modifications').click();
});
