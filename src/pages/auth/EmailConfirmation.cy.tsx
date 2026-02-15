import React from 'react'
import EmailConfirmation from './EmailConfirmation'

describe('<EmailConfirmation />', () => {
  it('renders', () => {
    // see: https://on.cypress.io/mounting-react
    cy.mount(<EmailConfirmation />)
  })
})