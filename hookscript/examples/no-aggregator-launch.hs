rule "Curve only for the first 5 minutes"
# Reads the app a trade came from: for the first 5 minutes, buys must go straight through the curve
# (Meteora DBC) or the hookrz router, not through an aggregator like Jupiter.

on buy:
  refuse if coin.age < 5m and transfer.app == program("jupiter")
    because "For the first 5 minutes, buy on the curve directly. Aggregators open in {5m - coin.age}"
