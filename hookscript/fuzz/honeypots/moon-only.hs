rule "sell only above 2x the launch price"
global launch_price: num
if launch_price == 0 { set launch_price = curve.price }
on sell:
  refuse if curve.price < launch_price * 2 because "Sells open at 2x"
