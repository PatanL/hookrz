rule "only the creator can sell"
on sell:
  refuse if not wallet.is_creator because "Only the dev sells"
