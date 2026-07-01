// Don't put any keys in code. See https://docs.stripe.com/keys-best-practices.
// Find your keys at https://dashboard.stripe.com/apikeys.
const stripe = require('stripe')('{{TEST_SECRET_KEY}}');

const product = await stripe.products.create({
  name: 'Example Product',
  default_price_data: {
    currency: 'usd',
    unit_amount: 2000,
  },
});