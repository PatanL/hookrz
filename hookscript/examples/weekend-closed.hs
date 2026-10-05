rule "Closed on weekends"
# The curve trades Monday to Friday, New York time (daylight saving included). Sends always work.
timezone "America/New_York"

on buy, sell:
  refuse if clock.weekday in [sat, sun]
    because "The curve is closed on weekends (New York time). It reopens Monday at midnight"
