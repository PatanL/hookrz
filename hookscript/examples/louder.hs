rule "Louder: the opening auction"
# $LOUDER. For the first 10 minutes every buy has to beat the last buy. The curve opens with a bang.

global last_buy: num

on buy {
  refuse if coin.age < 10m and amount <= last_buy
    because "Louder! Beat the last buy of {last_buy} tokens"
  set last_buy = amount
}
