rule "Birthday party hats"
# $BIRTHDAY. Everyone who buys in the first 60 seconds gets a party hat. Hat holders split 10% of creator
# fees while they hold. Selling takes the hat off, forever.

wallet hat: bool

payout 10% to wallets where hat

on buy:
  if coin.age < 60s { set wallet.hat = true }

on sell:
  set wallet.hat = false
