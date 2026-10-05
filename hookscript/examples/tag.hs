rule "Tag, you're it"
# $TAG. Whoever last received a wallet-to-wallet send is "it". It can't sell until it tags someone else
# by sending them tokens. It auto-releases after 6h.

global it: key
global tagged_at: time

on send:
  if receiver != sender {
    set it = receiver
    set tagged_at = clock.now
  }

on sell:
  refuse if seller == it and since(tagged_at) < 6h
    because "You're it! Tag someone (send them any amount) before you sell, or wait {6h - since(tagged_at)}"
