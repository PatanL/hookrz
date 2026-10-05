rule "Every 100th buy wins the pot"
# $JACKPOT. Buys are numbered on chain. Every 100th buyer is marked the winner, and the keeper pays
# them the pot: 25% of creator fees since the last winner. Dust buys under 0.01 SOL don't get a number.

global buys: int
global winner: key
global wins: int

payout 25% to winner as pot

on buy {
  if value >= 0.01 sol {
    set buys += 1
    if buys % 100 == 0 {
      set winner = buyer
      set wins += 1
    }
  }
}
