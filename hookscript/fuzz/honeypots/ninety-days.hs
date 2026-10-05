rule "90 day lock"
on sell:
  refuse if wallet.held < 90d because "Hold 90 days"
