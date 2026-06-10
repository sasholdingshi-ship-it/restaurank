#!/bin/bash
API="http://localhost:8765"
LOG="/var/log/restaurank-agent.log"
DATE=$(date '+%Y-%m-%d %H:%M')

echo "[$DATE] Agent Monitor starting" >> $LOG

for RID in 1 2; do
  STATUS=$(curl -s "$API/api/agent/status?restaurant_id=$RID")
  NEEDS=$(echo $STATUS | python3 -c "import sys,json; d=json.load(sys.stdin)['needs_action']; print(' '.join(k for k,v in d.items() if v))" 2>/dev/null)
  if [ -n "$NEEDS" ]; then
    echo "[$DATE] Restaurant $RID needs: $NEEDS" >> $LOG
  else
    echo "[$DATE] Restaurant $RID: all good" >> $LOG
  fi
done

# Track SEO score evolution (placeholder - will be real when Google Search Console connected)
curl -s -X POST "$API/api/metrics/track" -H "Content-Type: application/json" -d "{\"restaurant_id\":1,\"content_type\":\"global\",\"metric_type\":\"health_check\",\"value\":1,\"source\":\"cron\"}" > /dev/null
curl -s -X POST "$API/api/metrics/track" -H "Content-Type: application/json" -d "{\"restaurant_id\":2,\"content_type\":\"global\",\"metric_type\":\"health_check\",\"value\":1,\"source\":\"cron\"}" > /dev/null

echo "[$DATE] Agent Monitor done" >> $LOG
