rule "eternal king"
# King of the Hill without a lapse: if nobody outbids, the king is locked forever.
global king: key
global bar: num
on buy:
  if amount > bar { set king = buyer; set bar = amount }
on sell:
  refuse if wallet == king because "The king never sells"
