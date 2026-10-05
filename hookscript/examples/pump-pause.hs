rule "No buys after a 30% pump in 10 minutes"
# Compares the price after this buy with the coin's own price sample from about 10 minutes back.

on buy:
  refuse if curve.price > curve.price_at(ago: 10m) * 130%
    because "Price is up more than 30% in 10 minutes; buys pause until it cools off"
