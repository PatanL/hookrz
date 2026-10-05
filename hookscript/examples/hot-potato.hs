rule "Hot potato"
# A buy catches the potato when nobody holds it. The holder must pass it on within 2h by sending any
# amount to another wallet, and can't sell while holding it. Hold it past 2h and it burns you: no buys
# for 24h, and the potato is free again.

global potato: key
global caught_at: time
global loser: key
global burnt_at: time
global passes: int

# a potato held for 2h burns its holder (and lets go of them)
if potato != none and since(caught_at) >= 2h {
  set loser = potato
  set burnt_at = caught_at + 2h
  set potato = none
}

on buy {
  refuse if buyer == loser and since(burnt_at) < 24h
    because "The hot potato burnt you: no buys for {24h - since(burnt_at)}"
  if potato == none {
    set potato = buyer
    set caught_at = clock.now
  }
}

on send {
  if sender == potato and receiver != potato {
    set potato = receiver
    set caught_at = clock.now
    set passes += 1
  }
}

on sell:
  refuse if seller == potato
    because "You're holding the hot potato: send any amount to someone to pass it, or it burns in {2h - since(caught_at)}"
