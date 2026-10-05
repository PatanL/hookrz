rule "Library: quiet coin"
# $LIBRARY. One trade per wallet per hour, and nothing over 0.5% of supply in one go. Built to not make a chart.

wallet last_trade_at: time

on buy, sell {
  refuse if since(wallet.last_trade_at) < 1h
    because "Shh. One trade per wallet per hour. Next one in {1h - since(wallet.last_trade_at)}"
  refuse if amount > supply * 0.5%
    because "Shh. Nothing over 0.5% of supply in one go"
  set wallet.last_trade_at = clock.now
}
