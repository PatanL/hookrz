rule "Last call"
# $LASTCALL. The bar closes for buys 23:00-00:00 UTC every night. Sells stay open: last call, not a lock-in.

on buy:
  refuse if clock.hour(tz: "UTC") == 23
    because "Last call was at 22:59 UTC. Buys reopen at midnight; sells stay open"
