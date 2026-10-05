rule "No cutting the line"
# $QUEUE. Every new buyer takes a number. You can sell once 3 more wallets have bought after you, or
# after 12h of holding.

global buyers: int
wallet number: int

on buy:
  if wallet.number == 0 {
    set buyers += 1
    set wallet.number = buyers
  }

on sell:
  refuse if wallet.number > 0 and buyers - wallet.number < 3 and wallet.held < 12h
    because "No cutting the line: wait for 3 people to buy after you, or {12h - wallet.held}"
