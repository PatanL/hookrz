rule "Usurp the crown"
# $USURP. The biggest buy is king. Steal the crown by buying 1.2x the king's buy; that bar decays 1% a
# minute. The king can't sell or send while crowned, for at most 12h. The keeper pays the king half of
# creator fees for every minute they reign.

global king: key
global bar: num
global crowned_at: time

payout 50% to king

on buy:
  if amount > decay(bar, rate: 1%, every: 1m, since: crowned_at) * 1.2x {
    set king = buyer
    set bar = amount
    set crowned_at = clock.now
  }

on sell, send:
  refuse if wallet == king and since(crowned_at) < 12h
    because "Abdicate first: someone has to outbid you. The crown lapses in {12h - since(crowned_at)}"
