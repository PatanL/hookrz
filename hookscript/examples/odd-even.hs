rule "Odd and even"
# $ODDEVEN. Buys only on odd seconds, sells only on even seconds. Completely pointless, extremely memeable.

on buy:
  refuse if clock.second % 2 == 0 because "Buys only on odd seconds. Try again"
on sell:
  refuse if clock.second % 2 == 1 because "Sells only on even seconds. Try again"
