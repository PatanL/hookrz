rule "sell no more than you bought this hour"
# The site's old draftDemo #1. After an hour without buying, received(1h) is 0, so you can never sell.
on sell:
  refuse if amount > wallet.received(window: 1h)
    because "You can sell at most what you bought in the last 1h"
