rule "Sunrise in Tokyo"
# $SUNRISE. Buys and sells only while the sun is up in Tokyo. Sends always work.

on buy, sell:
  refuse if not daylight(tz: "Asia/Tokyo")
    because "The sun is down in Tokyo. Trading reopens at sunrise; sends always work"
