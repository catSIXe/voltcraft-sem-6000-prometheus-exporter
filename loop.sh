#!/bin/bash
expect ./voltcraft-sem-6000/sem-6000.exp server1-main --sync
while true; do
    echo "reset*"
    expect ./voltcraft-sem-6000/sem-6000.exp server1-main --device --sleep 1 --data header --data year --data month --data day --print --sleep 1 --measure header --measure 5
done