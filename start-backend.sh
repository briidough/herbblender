#!/bin/bash
export PATH="/home/archB/node-v25.9.0-linux-x64/bin:$PATH"
export LD_LIBRARY_PATH="/opt/oracle/instantclient_23_26:/run/host/usr/lib:$LD_LIBRARY_PATH"
cd "$(dirname "$0")/backend"
node index.js
