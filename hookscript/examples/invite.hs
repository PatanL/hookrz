rule "Invite only for the first hour"
# $INVITE. For the first hour you can only buy if a holder invited you by sending you at least 1 token.
# The creator's launch buy is the first invite. Invites spread like a group chat.

wallet invited: bool

on send:
  if amount >= 1 { set receiver.invited = true }

on buy:
  refuse if coin.age < 1h and not wallet.invited and not wallet.is_creator
    because "Invite only for the first hour: ask a holder to send you 1 token. Opens to everyone in {1h - coin.age}"
