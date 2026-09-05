#!/bin/sh
set -eu

# Give the update request time to reach the browser before stopping the container.
sleep 2
kill -TERM 1
