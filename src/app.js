const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const bgls = require('../src/bglswrapper.js');
const logger = bgls.logger;
const solc = require('solc');
const argv = require('minimist')(process.argv.slice(2));
const readlineSync = require('readline-sync');

// Default values
let CONTRACT_ADDRESS = '0xF7d58983Dbe1c84E03a789A8A2274118CC29b5da';
let CLIENT_COUNT = 22;
// const DEPOSIT_WEI = 25000000000000000000;      // 25 ether
let DEPOSIT_WEI = 25000000000000000000; // 1e18 * 25
let THRESHOLD = 14;
let OUTPUT_PATH = "../commit_data.json";
let INTERACTIVE = false;
let COMPLAINER_INDEX = -1; // 1-based
let MALICIOUS_INDEX = -1;
let ACCUSED_INDEX = -1; // 1-based

// Constants
const MIN_BLOCKS_MINED_TILL_COMMIT_IS_APPROVED = 11;
const CONTRACT_PATH = path.join(__dirname, '../contracts/dkgG2.sol');
const CONTRACT_NAME = 'dkgG2';
const CLIENTS = require('../data/accounts');

let dkgContract;
let allCommitDataJson;
const gasUsed = {join: 0, commit: 0, phaseChange: 0};

const enrollBlockToClient = {};
const commitBlockToClient = {};

// Entrypoint when calling directly with "node" command, not through run.sh.
// Useful for step-by-step debugging
// Example debugging command:
// node --inspect-brk src/app.js -n 22 -t 14 -d 25000000000000000000 -j ${HOME}/dev/orbs/go/src/github.com/orbs-network/bls-bn-curve/commit_data.json
if (require.main === module) {
  main();
}

// Entry point called by "truffle exec" in run.sh
module.exports = async function (callback) {

  await main();
  callback();
};

async function main() {
  try {
    processCommandLineArgs(argv);
    logger.info('=====> Starting main flow <=====');
    await deployManual();
    await enrollAllClients();

    if (COMPLAINER_INDEX > 0 && MALICIOUS_INDEX > 0 && ACCUSED_INDEX > 0) {
      logger.info(`Client ${COMPLAINER_INDEX} is complaining about client ${ACCUSED_INDEX}, and the actual culprit is client ${MALICIOUS_INDEX}`);
      allCommitDataJson = getCommitDataWithErrors(COMPLAINER_INDEX, MALICIOUS_INDEX);
      await commitAllClients(allCommitDataJson);
      verifyPrivateCommit(COMPLAINER_INDEX, ACCUSED_INDEX); // TODO   Fill this
      await sendComplaint(COMPLAINER_INDEX, ACCUSED_INDEX);
      // signAndVerify();
    } else {
      logger.info('No one is complaining so running the contract to completion');
      allCommitDataJson = getCommitData();
      await commitAllClients(allCommitDataJson);
      await phaseChange(CLIENTS[0]);
    }

  } catch (e) {
    console.log(e);
    process.exit(2);
  }
}

function processCommandLineArgs(myArgs) {
  CLIENT_COUNT = myArgs.n;
  THRESHOLD = myArgs.t;
  DEPOSIT_WEI = myArgs.d;
  OUTPUT_PATH = myArgs.j;
  COMPLAINER_INDEX = myArgs.c;
  MALICIOUS_INDEX = myArgs.m;
  ACCUSED_INDEX = myArgs.a;
}


async function deployManual() {
  let source = fs.readFileSync(CONTRACT_PATH, 'utf8');
  logger.info(`Compiling contract ${CONTRACT_PATH}`);
  let compiledContract = solc.compile(source, 1);
  const contractName = ":" + CONTRACT_NAME;
  const contract = compiledContract.contracts[contractName];
  let abi = contract.interface;
  let byteCode = contract.bytecode;
  // let gasEstimate = web3.eth.estimateGas({data: bytecode});
  let DKGContract = web3.eth.contract(JSON.parse(abi));
  logger.info(`Deploying contract ${CONTRACT_NAME} with t: ${THRESHOLD} n: ${CLIENT_COUNT} deposit_wei: ${DEPOSIT_WEI}`);

  await new Promise((resolve) => {
    DKGContract.new(THRESHOLD, CLIENT_COUNT, DEPOSIT_WEI, {
      from: CLIENTS[0].address,
      data: byteCode,
      gas: 3000000
    }, (err, contractInstance) => {
      if (!err) {
        // NOTE: The callback will fire twice!
        // Once the contract has the transactionHash property set and once its deployed on an address.

        // e.g. check tx hash on the first call (transaction send)
        if (!contractInstance.address) {
          logger.debug(`First callback call: txHash: ${contractInstance.transactionHash}`); // The hash of the transaction, which deploys the contract

          // check address on the second call (contract deployed)
        } else {
          logger.debug(`Second callback call: address: ${contractInstance.address}`); // the contract address
          dkgContract = contractInstance;
          resolve(dkgContract);
        }
      }
    });
  });

  logger.info(`Deployed DKG contract on address ${dkgContract.address}, txHash: ${dkgContract.transactionHash}`);
  logger.info(`----------------------------------------------------`);
  CONTRACT_ADDRESS = dkgContract.address;
  await printValuesFromContract();

}

async function enrollAllClients() {
  logger.info('=====> Starting enroll phase <=====');
  let i = 0;

  // Send the transactions
  for (let i = 0; i < CLIENT_COUNT; i++) {
    if (i < 2) {
      pause();
    }
    await enroll(CLIENTS[i], i);
  }

  logger.info(`***** Total gas used for enrollment: ${gasUsed.join} *****`);
  const balanceWei = web3.eth.getBalance(dkgContract.address);
  logger.info(`Contract balance: ${balanceWei} wei.`);


  console.log('');
  pause();
}


async function enroll(client, i) {
  logger.info(`Sending transaction to the contract's join() method with client address: ${toShortHex(client.address)} i: ${i}`);


  await new Promise((resolve, reject) => {

    const events = dkgContract.ParticipantJoined({address: client.address});
    logger.info(`Start watching @ParticipantJoined@: ${client.address}`);
    const clientAddr = client.address;
    events.watch((error, result) => {
      events.stopWatching();
      logger.info(`@ParticipantJoined@ fired: client: ${clientAddr} ID: ${result.args.index} block: ${result.blockNumber}`);
      // logger.info(`watch enroll: ${JSON.stringify(result)}`);
      const currentClient = enrollBlockToClient[result.blockHash];
      if (currentClient) {
        // logger.info(`Get txHash ${result.transactionHash} --> clientAddress ${client.address} --> ${result.args.index}`);
        currentClient.id = result.args.index;
        logger.info(`@ParticipantJoined@ Set ID ${currentClient.id} to client ${clientAddr} blockNumber ${result.blockNumber}`);
        resolve(result);
      } else {
        logger.info(`!!! @ParticipantJoined@ Client not found for blockHash ${result.blockHash}`);
        reject(result.blockHash);
      }
    });

    dkgContract.join(
      {
        from: client.address,
        value: DEPOSIT_WEI,
        gasLimit: 3000000,
      }, (err, result) => {
        if (err) {
          reject(err);
        } else {
          const receipt = web3.eth.getTransactionReceipt(result);
          // logger.info(`Join result: client: ${client.address} ${JSON.stringify(result)}`);
          logger.info(`Join result: client: ${client.address} blockNumber: ${receipt.blockNumber} blockHash: ${receipt.blockHash}`);
          // logger.info(`Join receipt: result: ${result} blockNumber: ${receipt.blockNumber} blockHash: ${receipt.blockHash}`);
          gasUsed.join += receipt.gasUsed;
          client.gasUsed += receipt.gasUsed;
          enrollBlockToClient[receipt.blockHash] = client;

        }
      });
  });
}

async function commitAllClients(json) {
  logger.info(` =====> Starting commit phase <=====`);
  const {CoefficientsAll, PubCommitG1All, PubCommitG2All, PrvCommitAll} = json;
  logger.info("Notice the difference in gas costs between join() and commit()");

  for (let i = 0; i < CLIENT_COUNT; i++) {
    if (i < 2) {
      pause();
    }
    await commit(CLIENTS[i], i, CoefficientsAll[i], PubCommitG1All[i], PubCommitG2All[i], PrvCommitAll[i]);
  }
  logger.info(`***** Total gas used for commit(): ${gasUsed.commit} *****`);
  const balanceWei = web3.eth.getBalance(dkgContract.address);
  logger.info(`Contract balance: ${balanceWei} wei`);
  console.log('');
  pause();
}


async function commit(client, i, coeffs, commitG1, commitG2, commitPrv) {

  if (!client.id) {
    throw new Error(`Missing client ID for client #${i} ${client.address}. Client ID is the result of join(). Did join() finished correctly?`);
  }

  const commitG1BigInts = commitG1.map(e => e.map(numstr => {
    return web3.toHex(numstr);
  }));
  const commitG2BigInts = commitG2.map(e => e.map(numstr => web3.toHex(numstr)));
  const prvBigInts = commitPrv.map(numstr => web3.toHex(numstr));

  logger.info(`===> Commit(Index: ${client.id}) <===`);
  const g1Flat = _.flatMap(commitG1BigInts);
  const g2Flat = _.flatMap(commitG2BigInts);
  logger.debug(`G1: ${JSON.stringify(g1Flat)}`);
  logger.debug(`G2: ${JSON.stringify(g2Flat)}`);
  logger.debug(`Prv: ${JSON.stringify(prvBigInts)}`);

  await new Promise((resolve, reject) => {

    const events = dkgContract.NewCommit({address: client.address});
    logger.info(`Start watching @NewCommit@: ${client.address}`);
    const clientAddr = client.address;
    events.watch((error, result) => {
      events.stopWatching();
      logger.info(`@NewCommit@ fired: client: ${clientAddr}`);
      const c = commitBlockToClient[result.blockHash];
      if (c) {
        logger.debug(`@NewCommit@ Result: ${JSON.stringify(result)}`);
        // logger.info(`@NewCommit@ Client ID ${client.id} blockHash: ${result.blockHash}`);
        // committed++;
        logger.info(`@NewCommit@ Client ID #${c.id} ${c.address} committed successfully.`);
        c.committed = true;
        resolve(c.id);
      } else {
        logger.info(`@NewCommit@ Client not found for blockHash: ${result.blockHash}`);
        reject(result.blockHash);
      }
    });

    dkgContract.commit(client.id, g1Flat, g2Flat, prvBigInts, {
      from: client.address,
      gas: 3000000
    }, (err, result) => {
      if (err) {
        reject(err);
      } else {
        // console.log("commit result: ", JSON.stringify(result));
        const receipt = web3.eth.getTransactionReceipt(result);
        commitBlockToClient[receipt.blockHash] = client;
        // console.log(`Commit receipt: ${JSON.stringify(receipt)}`);
        gasUsed.commit += receipt.gasUsed;
        client.gasUsed += receipt.gasUsed;
        logger.info(`Client ID #${client.id} of ${CLIENTS.length} *** Gas used: ${receipt.gasUsed}. *** Block ${receipt.blockNumber}`);
        logger.debug(`Commit(): Client ID #${client.id} ${client.address} committed successfully. Result: ${JSON.stringify(receipt)}`);
      }
    });
  });

}

function verifyPrivateCommit(complainerIndex, accusedIndex) {

  logger.info(`Now client ID #${complainerIndex} is verifying the private commitment of client ID #${accusedIndex}`);
  logger.info(`The private commitment of client ID #${accusedIndex} was intentionally tainted.`);


  const verifyResult = bgls.VerifyPrivateCommitment(complainerIndex, accusedIndex, OUTPUT_PATH);
  logger.info(`Verification passed? ${verifyResult}`);
  return verifyResult;
}


function getCommitData() {
  bgls.GetCommitDataForAllParticipants(THRESHOLD, CLIENT_COUNT, OUTPUT_PATH);
  const data = require(OUTPUT_PATH);
  // printDataPerClient(allCommitDataJson);
  logger.debug('Read contents of file ', OUTPUT_PATH);
  logger.info('Finished generating commitments data.');
  // pause();
  return data;
}

function getCommitDataWithErrors(complainerIndex, maliciousIndex) {
  bgls.GetCommitDataForAllParticipantsWithIntentionalErrors(THRESHOLD, CLIENT_COUNT, complainerIndex, maliciousIndex, OUTPUT_PATH);
  logger.info(`Reading data file (with intentional errors) ${OUTPUT_PATH} ...`);
  const data = require(OUTPUT_PATH);
  logger.debug('Read contents of file (with intentional errors)', OUTPUT_PATH);
  return data;
}

async function sendComplaint(complainerIndex, accusedIndex) {

  logger.info(`Now client ID #${complainerIndex} is sending a complaint on client ID #${accusedIndex}`);
  pause();
  const res = await dkgContract.complaintPrivateCommit(complainerIndex, accusedIndex, {
    from: CLIENTS[complainerIndex - 1].address,
    gasLimit: 3000000
  });

  logger.info(`Complaint sent. If the complaint was justified, the deposit of the accused client was split between the other clients, who also had their deposits returned.`);
  logger.info(`If the complaint was not justified, the deposit of the complaining client was split between the other clients, who also had their deposits returned.`);
  logger.info(`In either case, the contract is closed.`);


}


function signAndVerify() {
  pause();
  bgls.SignAndVerify(THRESHOLD, CLIENT_COUNT, OUTPUT_PATH);
}

async function phaseChange(client) {

// Separate to execution cost (function of opcodes) and transaction cost (execution cost + fixed cost per tx)

  logger.info(`We will now mine ${MIN_BLOCKS_MINED_TILL_COMMIT_IS_APPROVED} blocks to simulate that no one complained for some time after all commits were executed, therefore it is safe to finalize the commit() phase`);

  pause();
  await mineNBlocks(11);
  logger.info(`No one complained, so calling phaseChange() to finalize commit phase. `);
  logger.info(`Take note of the present balance of accounts and compare to after calling phaseChange().`);
  pause();
  const res = await new Promise((resolve, reject) => {
    dkgContract.phaseChange({
      from: client.address,
      gasLimit: 300000
    }, (err, result) => {
      if (err) {
        reject(err);
      } else {
        console.log("phaseChange result: ", JSON.stringify(result));
        const receipt = web3.eth.getTransactionReceipt(result);
        // console.log(`Commit receipt: ${JSON.stringify(receipt)}`);
        gasUsed.phaseChange += receipt.gasUsed;
        client.gasUsed += receipt.gasUsed;
        logger.info(`phaseChange(): finished successfully. *** Gas used: ${receipt.gasUsed}. *** Block ${receipt.blockNumber}`);
        logger.debug(`Commit(): Client ID #${client.id} ${client.address} committed successfully. Result: ${JSON.stringify(receipt)}`);
        const balanceWei = web3.eth.getBalance(dkgContract.address);
        logger.info(`Contract balance: ${balanceWei} wei`);
        logger.info('Now take note again of accounts balance, now that deposits have been refunded.');
        console.log('');
        logger.info(`***** Total gas used: ${getTotalGasUsed()} *****`);
        console.log('');

        const clients = CLIENTS.slice(CLIENT_COUNT);
        for (const client of clients) {
          logger.info(`Total gas used by client ${client.id}: ${client.gasUsed}`);
        }
        resolve(result);
      }
    });
  });

  // logger.info(`phaseChange(): finished successfully. *** Gas used: ${res.receipt.gasUsed}. *** Block: ${res.receipt.blockNumber}`);

}

function getTotalGasUsed() {
  return gasUsed.join + gasUsed.commit + gasUsed.phaseChange;
}

const mineOneBlock = async () => {

  // TODO replace this print with just the block number

  // logger.info(JSON.stringify(web3.eth));

  await web3.currentProvider.send({
    jsonrpc: '2.0',
    method: 'evm_mine',
    params: [],
    id: 200,
  });
};

const mineNBlocks = async n => {
  for (let i = 0; i < n; i++) {
    await mineOneBlock()
  }
};

async function printValuesFromContract() {
  const valuesFromContract = {};
  valuesFromContract.n = await dkgContract.n.call();
  valuesFromContract.t = await dkgContract.t.call();
  valuesFromContract.p = await dkgContract.p.call();
  valuesFromContract.q = await dkgContract.q.call();

  logger.info("Contract properties:");
  logger.info(` > n: ${valuesFromContract.n.toString()}`);
  logger.info(` > t: ${valuesFromContract.t.toString()}`);
  logger.info(` > p: ${valuesFromContract.p.toString()}`);
  logger.info(` > q: ${valuesFromContract.q.toString()}`);
}

function printAccounts() {
  for (const a of CLIENTS) {
    logger.info(`Account: ${a.address}`)
  }
  logger.info(`Total of ${CLIENTS.length} accounts`);
}

function toShortHex(hexStr) {
  return hexStr.substr(0, 6) + ".." + hexStr.substr(hexStr.length - 4);
}

function printDataPerClient(data) {

  // TODO Fix text and contents here

  CLIENTS.forEach((client, i) => {
    pause();
    console.log('');
    logger.info(`===> Data for client ID #${client.id} ${client.address} <===`);
    logger.info(`===================================================`);
    for (let j = 0; j < data.CoefficientsAll[i].length; j++) {
      logger.info(`Client ID #${i + 1}: Coefficient ${j}: ${data.CoefficientsAll[i][j]}`);
    }
    for (let j = 0; j < data.PubCommitG1All[i].length; j++) {
      logger.info(`Client ID #${i + 1}: Commitment on G1 for coefficient ${j}: ${data.PubCommitG1All[i][j]}`);
    }

    for (let j = 0; j < data.PubCommitG2All[i].length; j++) {
      logger.info(`Client ID #${i + 1}: Commitment on G2 for coefficient ${j}: ${data.PubCommitG2All[i][j]}`);
    }

    for (let j = 0; j < data.PrvCommitAll[i].length; j++) {
      logger.info(`Client ID #${i + 1}: f_${i + 1}(${j + 1}) = ${toShortHex(data.PrvCommitAll[i][j])}`);
    }

  });


  logger.info("")
}

function pause() {
  if (INTERACTIVE) {
    readlineSync.keyInPause();
  }
}

