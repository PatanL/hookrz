rule "King of the Hill"
# The biggest buy takes the crown. To take it you have to beat the king's buy, and that bar fades
# to zero over 6h. While crowned, the king can't sell or send; the crown (and the lock) lapses 6h after
# the coronation unless someone outbids. The keeper streams half the creator fees to the king.

global king: key
global bar: num
global crowned_at: time
global reigns: int

payout 50% to king

on buy {
  let need = fade(bar, over: 6h, since: crowned_at)
  if amount > need {
    set king = buyer
    set bar = amount
    set crowned_at = clock.now
    set reigns += 1
  }
}

on sell, send {
  refuse if wallet == king and since(crowned_at) < 6h
    because "You're the king: no selling or sending for {6h - since(crowned_at)}, unless someone outbids you"
}
