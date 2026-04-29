#!/bin/bash
export PATH="/home/archB/node-v25.9.0-linux-x64/bin:$PATH"
cd "$(dirname "$0")/teaBrowser"
node server.js