rule "Open mic: one buyer per 30 seconds"
# The first buyer in a 30-second slot holds the mic and can keep buying. Everyone else waits for the
# next slot. Bot piles at launch become a queue.

global mic: key
global mic_at: time

on buy {
  refuse if since(mic_at) < 30s and buyer != mic
    because "Someone has the mic. The next slot opens in {30s - since(mic_at)}"
  if since(mic_at) >= 30s {
    set mic = buyer
    set mic_at = clock.now
  }
}
