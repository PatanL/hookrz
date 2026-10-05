rule "Stairs: every buy at most 2x the last one"
# Buy sizes climb like stairs: no buy may be more than twice the previous buy. Any buy up to 2% of supply
# is always fine, so a dust buy can't freeze the stairs.

global last_buy: num

on buy {
  let cap = max(last_buy * 2x, supply * 2%)
  refuse if amount > cap
    because "One step at a time: the biggest buy right now is {cap} tokens"
  set last_buy = amount
}
