#!/usr/bin/env bash

# Import common variables.
. scripts/common.sh

# Executes cleanup function at script exit.


GANACHE_PORT=7545

CLIENT_COUNT=5 # 22
THRESHOLD=2 # 14
DEPOSIT_WEI=25000000000000000000
KEEP_GANACHE_ALIVE=false
DATA_FILE=$(pwd)/commit_data.json
MNEMONIC="decorate provide ritual swarm will inmate sausage lab banana daring trash liar"

while getopts ":n:t:pk" opt; do
  case $opt in
    n)
      NODE_COUNT=$OPTARG
      ;;
    t)
      THRESHOLD=$OPTARG
      ;;
    p)
      GANACHE_PORT=$OPTARG
      ;;
    k)
      KEEP_GANACHE_ALIVE=true
      ;;
    \?)
      echo "Invalid option: -$OPTARG" >&2
      ;;
  esac
done

if [[ "$KEEP_GANACHE_ALIVE" = "false" ]] ; then
  echo "Will stop Ganache instance when exiting"
  trap cleanup EXIT
fi

if ganache_running $GANACHE_PORT; then
  echo "Ganache instance already running on port $GANACHE_PORT, using it."
else
  echo "Starting ganache instance"
  ./node_modules/.bin/ganache-cli --accounts ${CLIENT_COUNT} --deterministic --mnemonic "${MNEMONIC}" -p "$GANACHE_PORT" > ganache.log &
  ganache_pid=$!
  echo "Started ganache with pid $ganache_pid"
#  account_setup
fi

node_modules/.bin/truffle exec src/app.js -n ${CLIENT_COUNT} -t ${THRESHOLD} -d ${DEPOSIT_WEI} -j ${DATA_FILE}
rc=$?
echo "Finished with rc=$rc"
if [[ $rc -ne 0 ]] ; then
  echo "Error enrolling and committing clients. Exiting."
  if [[ $ganache_pid -ne 0 ]] ; then
    echo "Ganache instance is still running, pid $ganache_pid"
  fi
  exit 1
fi

./bls-bn-curve -func=SignAndVerify ${THRESHOLD} ${CLIENT_COUNT} ${DATA_FILE}


account_setup() {
  echo "Starting account setup"

}

