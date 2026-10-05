rule "FOMO: the last buyer before the clock runs out wins"
# Every buy adds 30s to a countdown (capped at 1h ahead). When it hits zero, the last buyer wins the pot
# (30% of creator fees since the last round) and a new round starts with the next buy. In the final
# minute, buys must be at least 0.05 SOL, so nobody wins a round with dust.

global deadline: time
global last_buyer: key
global winner: key
global round: int

payout 30% to winner as pot

on buy {
  let live = deadline != 0 and clock.now < deadline
  refuse if live and deadline - clock.now < 1m and value < 0.05 sol
    because "Final minute: buys must be at least 0.05 SOL. {deadline - clock.now} left"
  if not live {
    if last_buyer != none {
      set winner = last_buyer
      set round += 1
    }
    set deadline = clock.now + 1h
  } else {
    set deadline = min(deadline + 30s, clock.now + 1h)
  }
  set last_buyer = buyer
}
