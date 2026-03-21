describe('pre-production battle suggestions validation', () => {
  it('renders runtime matchmaking suggestions for an authenticated active producer', () => {
    cy.readFile('/tmp/sb-session.json').then((session) => {
      cy.visit('http://127.0.0.1:5173/producer/battles', {
        onBeforeLoad(win) {
          win.localStorage.setItem(
            'sb-haebgsnncuikvfgivxwk-auth-token',
            JSON.stringify(session),
          );
        },
      });
    });

    cy.contains('Matchmaking').should('be.visible');
    cy.contains('producteur01').should('be.visible');
    cy.contains('producteur02').should('be.visible');
    cy.contains('Fallback SQL matchmaking based on ELO proximity and active producer filters.').should('be.visible');
  });
});
