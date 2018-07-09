#!/usr/bin/env bash

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

function unify() {
	grep -v "^[pragma|import]" $DIR/$1 >> Unified.sol
}

echo "pragma solidity 0.4.24;" > Unified.sol

# Specify additional contracts like in these examples:

# unify ../node_modules/zeppelin-solidity/contracts/math/Math.sol
# unify ../node_modules/zeppelin-solidity/contracts/math/SafeMath.sol
# unify ../node_modules/zeppelin-solidity/contracts/ownership/Ownable.sol
# unify ../node_modules/zeppelin-solidity/contracts/ownership/CanReclaimToken.sol

# unify ../contracts/MyContract.sol
