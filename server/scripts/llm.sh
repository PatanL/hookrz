#!/usr/bin/env bash
# The open-source model behind "describe your rule in English" (hookscript/drafter, provider "local").
# vLLM in Docker, OpenAI-compatible, on 127.0.0.1:8840 only (the API server calls it; it is never exposed).
#   scripts/llm.sh start [27b|9b]   start (or restart with) a model; prints the endpoint when it answers
#   scripts/llm.sh stop             stop the container (frees the GPU)
#   scripts/llm.sh status
# The API reads HOOKSCRIPT_LLM_URL=http://127.0.0.1:8840/v1 (see ~/.config/systemd/user/hookrz-api.service); when the model
# is down the drafter falls back to the offline templates. Not restarted at boot (shared Spark): start it by hand.
# Scored with hookscript/drafter/eval-local.ts on 2026-10-04: 27b 18/20 (median 24 s), 9b 17/20 (median 9 s, logic slips).
set -euo pipefail
NAME=hookrz-llm
PORT=8840
IMAGE=vllm/vllm-openai:v0.27.1

case "${2:-27b}" in
  27b) MODEL=Qwen/Qwen3.8-27B-FP8; SERVED=qwen3.8-27b-fp8; UTIL=0.31 ;;
  9b) MODEL=RedHatAI/Qwen3.5-9B-FP8-dynamic; SERVED=qwen3.5-9b-fp8; UTIL=0.22 ;;
  *) echo "model: 27b or 9b" >&2; exit 2 ;;
esac

case "${1:-status}" in
  start)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    sleep 3
    avail=$(free -g | awk '/^Mem:/ {print $7}')
    if [ "$avail" -lt 50 ]; then echo "only ${avail} GB free; not starting a model (Spark load limits)" >&2; exit 1; fi
    docker run -d --name "$NAME" --gpus all --ipc=host --restart no \
      -p 127.0.0.1:$PORT:8000 \
      -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
      -e HF_HUB_OFFLINE=1 \
      "$IMAGE" "$MODEL" \
      --served-model-name "$SERVED" --host 0.0.0.0 --port 8000 \
      --gpu-memory-utilization "$UTIL" --max-model-len 24576 --max-num-seqs 2 \
      --enable-prefix-caching --limit-mm-per-prompt '{"image":0,"video":0}' >/dev/null
    echo "starting $MODEL as $NAME (gpu util $UTIL)…"
    for _ in $(seq 1 120); do
      if curl -sf "http://127.0.0.1:$PORT/v1/models" >/dev/null; then echo "ready: http://127.0.0.1:$PORT/v1 ($SERVED)"; exit 0; fi
      if ! docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null | grep -qx true; then docker logs --tail 40 "$NAME" >&2; exit 1; fi
      sleep 5
    done
    echo "not ready after 10 minutes; docker logs $NAME" >&2; exit 1 ;;
  stop) docker stop "$NAME" >/dev/null 2>&1 && echo stopped || echo "not running" ;;
  status) curl -sf "http://127.0.0.1:$PORT/v1/models" | python3 -c 'import json,sys; print("ready:", [m["id"] for m in json.load(sys.stdin)["data"]])' 2>/dev/null || echo "not running" ;;
  *) echo "usage: scripts/llm.sh start [27b|9b] | stop | status" >&2; exit 2 ;;
esac
