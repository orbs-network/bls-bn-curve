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
COMPLAINER_INDEX=1 # 1-based, the client that complains about client ACCUSED_INDEX
MALICIOUS_INDEX=2 # 1-based, the client that actually tainted its data
ACCUSED_INDEX=2 # 1-based, the client that is accused by client COMPLAINER_INDEX of tainting its data

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
    c)
      COMPLAINER_INDEX=$OPTARG
      ;;
    m)
      MALICIOUS_INDEX=$OPTARG
      ;;
    a) ACCUSED_INDEX=$OPTARG
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

cmd="node_modules/.bin/truffle exec src/app.js -n ${CLIENT_COUNT} -t ${THRESHOLD} -d ${DEPOSIT_WEI} -j ${DATA_FILE} -c ${COMPLAINER_INDEX} -m ${MALICIOUS_INDEX} -a ${ACCUSED_INDEX}"
echo "Running command: ${cmd}"
${cmd}

rc=$?
echo "Finished with rc=$rc"
if [[ $rc -ne 0 ]] ; then
  echo "Error enrolling and committing clients. Exiting."
  if [[ $ganache_pid -ne 0 ]] ; then
    echo "Ganache instance is still running, pid $ganache_pid"
  fi
  exit 1
fi

#./bls-bn-curve -func=SignAndVerify ${THRESHOLD} ${CLIENT_COUNT} ${DATA_FILE}


account_setup() {
  echo "Starting account setup"

}

