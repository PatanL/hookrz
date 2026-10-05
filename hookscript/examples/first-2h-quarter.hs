rule "No single sell over a quarter of your bag in your first 2h"
# The site's example rule. New holders can still sell, just in slices.

on sell:
  refuse if wallet.held < 2h and amount > wallet.balance * 25%
    because "No single sell over a quarter of your bag in your first 2h"
