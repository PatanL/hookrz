rule "One bite per wallet"
# $ONEBITE. Every wallet gets exactly one buy, ever. No adding, no averaging down.

wallet bitten: bool

on buy {
  refuse if wallet.bitten
    because "One bite per wallet: you already bought"
  set wallet.bitten = true
}
