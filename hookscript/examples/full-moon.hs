rule "Werewolves only"
# $FULLMOON. On the full moon (a 24-hour window around the exact moment) sells are closed.

on sell:
  refuse if moon_phase() == full
    because "It's a full moon. Sells reopen when it passes"
