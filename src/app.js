const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const bgls = require('../src/bglswrapper.js');
const logger = bgls.logger;
const solc = require('solc');
const argv = require('minimist')(process.argv.slice(2));
const readlineSync = require('readline-sync');
const async = require('async');

// Default values
let CONTRACT_ADDRESS = '0xF7d58983Dbe1c84E03a789A8A2274118CC29b5da';
let CLIENT_COUNT = 22;
// const DEPOSIT_WEI = 25000000000000000000;      // 25 ether
let DEPOSIT_WEI = 25000000000000000000; // 1e18 * 25
let THRESHOLD = 14;
let OUTPUT_PATH = "../commit_data.json";
let INTERACTIVE = false;
let COMPLAINER_INDEX = 0; // 1-based
let MALICIOUS_INDEX = 0; // 1-based
let ACCUSED_INDEX = 0; // 1-based

// Constants
let MIN_BLOCKS_MINED_TILL_COMMIT_IS_APPROVED = 11;
const CONTRACT_PATH = path.join(__dirname, '../contracts/dkgEnc.sol');
const CONTRACT_NAME = 'dkgEnc';
const CLIENTS = require('../data/accounts');

let dkgContract;

let dataPerParticipant = [];
const gasUsed = {join: 0, commit: 0, phaseChange: 0};

const enrollBlockToClient = {};
const commitBlockToClient = {};

// Entry point when calling directly with "node" command, not through run.sh.
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

// For each client, generate SK and PK
function generateKeys() {
  for (let i = 0; i < CLIENT_COUNT; i++) {
    const res = bgls.GenerateKeyPair();
    const json = JSON.parse(res);
    CLIENTS[i].sk = json.sk; // bigint (as hex string)
    CLIENTS[i].pk = json.pk; // bigint[2] (as array hex string[2])
    logger.info(`i: ${i} SK: ${CLIENTS[i].sk} PK0: ${CLIENTS[i].pk[0]} PK1: ${CLIENTS[i].pk[1]}`)
  }

}

async function main() {
  try {
    processCommandLineArgs(argv);
    logger.info('=====> Starting main flow <=====');
    generateKeys();
    await deployManual();
    let timeout = await dkgContract.commitTimeout.call();
    MIN_BLOCKS_MINED_TILL_COMMIT_IS_APPROVED = timeout + 1;
    createPhaseChangeListener();
    await enrollAllClients();

    if (COMPLAINER_INDEX > 0 && MALICIOUS_INDEX > 0 && ACCUSED_INDEX > 0) {
      logger.info(`Client ${COMPLAINER_INDEX} is complaining about client ${ACCUSED_INDEX}, and the actual culprit is client ${MALICIOUS_INDEX}`);
      dataPerParticipant = getCommitDataWithErrors(COMPLAINER_INDEX, MALICIOUS_INDEX);
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dataPerParticipant));
      // logger.info(`Data (partially tainted): ${JSON.stringify(dataPerParticipant)}`);
      await commitAllClients(dataPerParticipant);
      verifyPrivateCommit(COMPLAINER_INDEX, ACCUSED_INDEX);
      await sendComplaint(COMPLAINER_INDEX, ACCUSED_INDEX);
    } else {
      logger.info('No one is complaining so running the contract to completion');
      dataPerParticipant = getCommitData();
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dataPerParticipant));
      // logger.debug(`Data: ${JSON.stringify(dataPerParticipant)}`);
      await commitAllClients(dataPerParticipant);
      await phaseChange(CLIENTS[0]);
      signAndVerify();
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

function populateParticipants() {
  // TODO impl me
}

function createPhaseChangeListener() {
  const events = dkgContract.PhaseChange();
  events.watch((error, result) => {
    const phase = result.args.phase; // enum Phase { Enrollment, Commit, PostCommit, EndSuccess, EndFail } // start from 0
    logger.info(`@@@PhaseChange@@@ fired: new phase: ${phase} result: ${JSON.stringify(result)} block: ${result.blockNumber}`);

    switch (phase) {
      case 1:
        populateParticipants();
        break;
    }

    // logger.info(`watch enroll: ${JSON.stringify(result)}`);
  });
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

    const pk0 = web3.toBigNumber(client.pk[0]);
    const pk1 = web3.toBigNumber(client.pk[1]);

    logger.info(`join() params: pk0: ${pk0} pk1: ${pk1}`);
    dkgContract.join([pk0, pk1], // bigint[2]
      {
        from: client.address,
        value: DEPOSIT_WEI,
        gas: 3000000,
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

async function commitAllClients(data) {
  logger.info(` =====> Starting commit phase <=====`);
  // const {CoefficientsAll, PubCommitG1All, PubCommitG2All, PrvCommitAll} = json;
  logger.info("Notice the difference in gas costs between join() and commit()");

  for (let i = 0; i < CLIENT_COUNT; i++) {
    if (i < 2) {
      pause();
    }
    await commit(CLIENTS[i], i, data[i].Coefficients, data[i].PubCommitG1, data[i].PubCommitG2, data[i].PrvCommit);
    const isCommitted = await dkgContract.getParticipantIsCommitted(CLIENTS[i].id);
    const curN = await dkgContract.curN.call();
    const curPhase = await dkgContract.curPhase.call();
    logger.info(`isCommitted(${CLIENTS[i].id}): ${isCommitted} curN: ${curN} curPhase: ${curPhase}`);
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

  const prv = commitPrv.map(numstr => web3.toHex(numstr));
  //
  // logger.info(`===> Commit(Index: ${client.id}) <===`);
  logger.debug(`G1: ${JSON.stringify(commitG1)}`);
  logger.debug(`G2: ${JSON.stringify(commitG2)}`);
  logger.debug(`Prv: ${JSON.stringify(prv)}`);

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

    dkgContract.commit(client.id, commitG1, commitG2, prv, {
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
        logger.info(`Client ID #${client.id} of ${CLIENT_COUNT} *** Gas used: ${receipt.gasUsed}. *** Block ${receipt.blockNumber}`);
        logger.debug(`Commit(): Client ID #${client.id} ${client.address} committed successfully. Result: ${JSON.stringify(receipt)}`);
      }
    });
  });

}

function verifyPrivateCommit(complainerIndex, accusedIndex) {

  logger.info(`verifyPrivateCommit(): Now client ID #${complainerIndex} (complainer) is verifying the private commitment of client ID #${accusedIndex} (accused)`);
  logger.info(`The private commitment of client ID #${accusedIndex} was intentionally tainted.`);


  const verifyResult = bgls.VerifyPrivateCommitment(complainerIndex, accusedIndex, OUTPUT_PATH);
  logger.info(`Verification passed? ${verifyResult}`);
  return verifyResult;
}


function getCommitData() {

  const data = bgls.GetCommitDataForAllParticipants(THRESHOLD, CLIENTS, CLIENT_COUNT);
  // const data = require(OUTPUT_PATH);
  // printDataPerClient(allCommitDataJson);
  logger.info('Finished generating commitments data.');
  for (let i = 0; i < CLIENT_COUNT; i++) {
    data[i].PK = CLIENTS[i].pk;
    data[i].SK = CLIENTS[i].sk;
  }

  // pause();
  return data;
}

function getCommitDataWithErrors(complainerIndex, maliciousIndex) {

  const data = getCommitData();

  // Actual data is 0-based so -1 the input values which are 1-based
  data[maliciousIndex - 1].PrvCommitEnc[complainerIndex - 1] = "0x00000000000000001234567812345678123456781234567812345678FFFFFFFF"; // Taint the data
  logger.info(`Tainted private commitment of maliciousIndex=${maliciousIndex} to complainerIndex=${complainerIndex}.`);

  return data;

}

async function sendComplaint(complainerIndex, accusedIndex) {

  pause();
  const complainerSK = CLIENTS[complainerIndex - 1].sk;
  const complainerID = CLIENTS[complainerIndex - 1].id;
  const complainerAddress = CLIENTS[complainerIndex - 1].address;
  const accusedID = CLIENTS[accusedIndex - 1].id;
  const curPhase = await dkgContract.curPhase.call();
  const accusedEncPk = await dkgContract.getParticipantPkEnc.call(accusedID);
  const encPrvCommit = await dkgContract.getParticipantPrvCommit.call(accusedID, complainerID);
  const pubCommitG1_0 = await dkgContract.getParticipantPubCommitG1.call(accusedID, 0);
  const pubCommitG1_1 = await dkgContract.getParticipantPubCommitG1.call(accusedID, 1);
  const pubCommitG1_t = await dkgContract.getParticipantPubCommitG1.call(accusedID, THRESHOLD);

  const g0_res = await dkgContract.ecmul.call(pubCommitG1_0, 2);
  const g1_res = await dkgContract.ecmul.call(pubCommitG1_1, 2);
  const gt_res = await dkgContract.ecmul.call(pubCommitG1_t, 2);



  logger.info(`sendComplaint(): Now client ID #${complainerID} THRESHOLD=${THRESHOLD} (addr: ${complainerAddress}) is sending a complaint on client ID #${accusedID}. Phase: ${curPhase} SK: ${complainerSK}`);
  logger.debug(`sendComplaint(): pubCommitG1_0=${pubCommitG1_0[0].toNumber()},${pubCommitG1_0[1].toNumber()} pubCommitG1_t=${pubCommitG1_t[0].toNumber()},${pubCommitG1_t[1].toNumber()}`);
  logger.debug(`sendComplaint(): decrypt(accusedEncPk=${accusedEncPk},complainerSk=${complainerSK},encPrvCommit=${encPrvCommit}`);
  logger.debug(`sendComplaint(): g0_res=${g0_res} g1_res=${g1_res} gt_res=${gt_res}`);

  // const decryptRes = await dkgContract.decrypt.call(accusedEncPk, complainerSK, encPrvCommit);
  // logger.debug(`decrypt() res=${decryptRes}`);

  let res = null;
  try {
    res = await dkgContract.complaintPrivateCommit(complainerID, accusedID, complainerSK, {
      from: complainerAddress,
      gas: 3000000
    });
  } finally {
    logger.info(`sendComplaint(): res: ${JSON.stringify(res)}`);
  }

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
  await mineNBlocks(MIN_BLOCKS_MINED_TILL_COMMIT_IS_APPROVED);
  logger.info(`No one complained, so calling phaseChange() to finalize commit phase. `);
  logger.info(`Take note of the present balance of accounts and compare to after calling phaseChange().`);
  pause();
  const res = await new Promise((resolve, reject) => {
    dkgContract.phaseChange({
      from: client.address,
      gas: 300000
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

        for (let i = 0; i < CLIENT_COUNT; i++) {
          logger.info(`Total gas used by client ${CLIENTS[i].id}: ${CLIENTS[i].gasUsed}`);
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
  forceMineBlocks(n, err => console.log(`err: ${err} ${JSON.stringify(err)}`))
  // for (let i = 0; i < n; i++) {
  //   await mineOneBlock()
  // }
};

function forceMineBlocks(numOfBlockToMine, cb) {
  const mineArr = [];
  for (let i = 0; i < numOfBlockToMine; i++) {
    mineArr.push(async.apply(web3.currentProvider.sendAsync, {
      jsonrpc: "2.0",
      method: "evm_mine",
      id: 12345
    }));
  }


  async.parallel(mineArr, (err) => {
    cb(err);
  });
}

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

