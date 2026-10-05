// Example rules from hookscript/examples, phrased the way a creator would say them (the offline drafter knows each one).
// Never suggest a rule that caps sells at what a wallet bought recently: that shape is a honeypot (the bank run gets stuck).
export const EXAMPLES = [
  { label: 'King of the Hill', text: 'King of the Hill: the biggest buy takes the crown, and the king can\'t sell for 6h unless someone outbids them' },
  { label: 'Invite only', text: 'Invite only for the first hour: you can buy only if a holder sent you a token' },
  { label: 'Louder', text: 'Louder: for the first 10 minutes every buy has to beat the last buy' },
  { label: 'Quarter bag', text: 'No single sell over a quarter of your bag in your first 2h' },
];
